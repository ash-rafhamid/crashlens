import { useEffect, useMemo, useState } from "react";
import CrashLens, { type BrowserInfo } from "@crashlens/browser-sdk";

interface Product {
  name: string;
  description: string;
  price: number;
  priceLabel: string;
  color: string;
}

type CheckoutScenario =
  | "success"
  | "payment-declined"
  | "gateway-down"
  | "malformed-response"
  | "timeout"
  | "out-of-stock"
  | "session-expired"
  | "invalid-coupon";

const products: Product[] = [
  { name: "Cloud Runner", description: "Everyday trainers", price: 4490, priceLabel: "৳4,490", color: "lime" },
  { name: "Metro Pack", description: "Weatherproof backpack", price: 2850, priceLabel: "৳2,850", color: "violet" },
  { name: "Pulse Buds", description: "Wireless audio", price: 3200, priceLabel: "৳3,200", color: "cyan" }
];

const scenarios: Array<{ value: CheckoutScenario; label: string; result: string }> = [
  { value: "success", label: "Successful payment", result: "200 · no CrashLens error" },
  { value: "payment-declined", label: "Bank declines payment", result: "402 · caught and reported" },
  { value: "gateway-down", label: "bKash gateway unavailable", result: "503 · caught and reported" },
  { value: "malformed-response", label: "Server forgets order ID", result: "200 · automatic JavaScript crash" },
  { value: "timeout", label: "Checkout request times out", result: "Abort · automatic Promise error" },
  { value: "out-of-stock", label: "Product becomes out of stock", result: "409 · caught and reported" },
  { value: "session-expired", label: "Customer session expires", result: "401 · caught and reported" },
  { value: "invalid-coupon", label: "Coupon expires during checkout", result: "422 · caught and reported" }
];

const checkoutApi = import.meta.env.VITE_CRASHLENS_API_URL ?? "http://localhost:4000";
const dashboardUrl = import.meta.env.VITE_CRASHLENS_DASHBOARD_URL ?? "http://localhost:3000";

function testError(message: string): Error {
  return new Error(message);
}

export default function App() {
  const [cartProduct, setCartProduct] = useState<Product | null>(null);
  const [scenario, setScenario] = useState<CheckoutScenario>("success");
  const [paymentMethod, setPaymentMethod] = useState<"bKash" | "Card" | "Cash on delivery">("bKash");
  const [customerId, setCustomerId] = useState(() => `customer-${Math.floor(Math.random() * 90) + 10}`);
  const [browserInfo, setBrowserInfo] = useState<BrowserInfo | undefined>();
  const [notice, setNotice] = useState("Add a product to begin a realistic checkout test.");
  const [noticeKind, setNoticeKind] = useState<"idle" | "success" | "error">("idle");
  const [processing, setProcessing] = useState(false);
  const [suiteRunning, setSuiteRunning] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void CrashLens.getBrowserInfo().then((info) => {
      if (active) setBrowserInfo(info);
    });
    return () => {
      active = false;
    };
  }, []);

  const selectedScenario = useMemo(
    () => scenarios.find((item) => item.value === scenario) ?? scenarios[0]!,
    [scenario]
  );

  function addToBag(product: Product) {
    setCartProduct(product);
    setNotice(`${product.name} was added. Continue to the checkout sandbox below.`);
    setNoticeKind("success");
    CrashLens.addBreadcrumb("cart", `Added ${product.name} to bag`);
    window.location.hash = "demo";
  }

  async function handleCheckout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cartProduct || processing) return;

    const cleanCustomerId = customerId.trim() || "anonymous-customer";
    CrashLens.setUser(cleanCustomerId);
    CrashLens.addBreadcrumb("checkout", `${cleanCustomerId} selected ${paymentMethod}`);
    CrashLens.addBreadcrumb("checkout.test", `Sandbox outcome: ${selectedScenario.label}`);
    setProcessing(true);
    setNotice(`Contacting the checkout API for: ${selectedScenario.label}…`);
    setNoticeKind("idle");

    const controller = new AbortController();
    const abortTimer = window.setTimeout(() => controller.abort(), 700);

    try {
      const response = await fetch(`${checkoutApi}/demo/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario, product: cartProduct.name, paymentMethod, customerId: cleanCustomerId }),
        signal: controller.signal
      });
      const body = (await response.json()) as { orderId?: string; code?: string; message?: string };

      if (scenario === "malformed-response" && !body.orderId) {
        setNotice("The API said paid but forgot the order ID. JavaScript will crash automatically.");
        setNoticeKind("error");
        window.setTimeout(() => {
          throw testError("Checkout response is missing the required orderId");
        }, 0);
        return;
      }

      if (!response.ok) {
        throw testError(`${body.message ?? "Checkout failed"} (HTTP ${response.status})`);
      }

      setNotice(`Success — order ${body.orderId} was created. No error should appear in CrashLens.`);
      setNoticeKind("success");
    } catch (error) {
      if (controller.signal.aborted) {
        const timeoutError = testError("Checkout request timed out after 700ms");
        setNotice("The request timed out. An unhandled Promise error will be reported automatically.");
        setNoticeKind("error");
        window.setTimeout(() => void Promise.reject(timeoutError), 0);
      } else {
        const sent = await CrashLens.captureException(error, {
          userId: cleanCustomerId,
          extra: {
            scenario,
            product: cartProduct.name,
            productPrice: cartProduct.price,
            paymentMethod,
            apiEndpoint: "/demo/checkout",
            responseHandled: true
          }
        });
        setNotice(sent ? "Checkout failed safely and CrashLens received the report." : "Checkout failed, but the report could not be sent.");
        setNoticeKind("error");
      }
    } finally {
      window.clearTimeout(abortTimer);
      setProcessing(false);
    }
  }

  async function runGroupingTest() {
    setSuiteRunning("grouping");
    setNotice("Sending the exact same production-style error five times…");
    for (let index = 0; index < 5; index += 1) {
      await CrashLens.captureException(testError("Load test: payment gateway unavailable"), {
        userId: customerId,
        extra: { test: "grouping", attempt: index + 1, paymentMethod: "bKash" }
      });
    }
    setNotice("Grouping test sent: expect one issue with 5 events.");
    setNoticeKind("success");
    setSuiteRunning(null);
  }

  async function runMultiUserTest() {
    setSuiteRunning("users");
    setNotice("Sending one shared failure from five different customers…");
    for (let index = 1; index <= 5; index += 1) {
      await CrashLens.captureException(testError("Load test: checkout unavailable for multiple customers"), {
        userId: `load-customer-${index}`,
        extra: { test: "affected-users", customerNumber: index }
      });
    }
    setNotice("Multi-user test sent: expect one issue, 5 events, and 5 affected users.");
    setNoticeKind("success");
    setSuiteRunning(null);
  }

  async function runPrivacyTest() {
    setSuiteRunning("privacy");
    await CrashLens.captureException(testError("Security test: checkout validation failed"), {
      userId: customerId,
      extra: {
        test: "privacy-redaction",
        password: "should-never-be-stored",
        cardNumber: "4111111111111111",
        accessToken: "secret-demo-token",
        safeNote: "This safe value should remain visible"
      }
    });
    setNotice("Privacy test sent. Password, card number, and token should show as [Redacted].");
    setNoticeKind("success");
    setSuiteRunning(null);
  }

  const browserLabel = browserInfo
    ? `${browserInfo.name}${browserInfo.version ? ` ${browserInfo.version}` : ""}`
    : "Detecting current browser…";

  return (
    <main>
      <nav>
        <div className="brand"><span>C</span> Cartly</div>
        <div className="nav-links"><a href="#products">Shop</a><a href="#demo">Checkout sandbox</a><a href="#test-suite">Test suite</a></div>
        <div className="cart">Bag <strong>{cartProduct ? 1 : 0}</strong></div>
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow">PRODUCTION-LIKE TEST SHOP</p>
          <h1>Shop normally.<br /><em>Test failures safely.</em></h1>
          <p className="hero-copy">A realistic checkout calls a real local API. Choose how the sandbox backend responds and verify what CrashLens captures.</p>
          <a className="primary" href="#products">Choose a product</a>
        </div>
        <div className="hero-art"><div className="orb orb-one"/><div className="orb orb-two"/><span>08</span></div>
      </section>

      <section className="products" id="products">
        {products.map((product, index) => (
          <article key={product.name}>
            <div className={`product-art ${product.color}`}><span>0{index + 1}</span></div>
            <div className="product-info"><div><h2>{product.name}</h2><p>{product.description}</p></div><strong>{product.priceLabel}</strong></div>
            <button className="add-button" onClick={() => addToBag(product)}>{cartProduct?.name === product.name ? "✓ Added to bag" : "Add to bag"}</button>
          </article>
        ))}
      </section>

      <section className="sandbox" id="demo">
        <div className="sandbox-heading">
          <div><p className="eyebrow">REAL CHECKOUT SANDBOX</p><h2>One checkout.<br />Eight backend outcomes.</h2><p>This sends a real HTTP request to the configured CrashLens API.</p></div>
          <div className="browser-check"><span><i /> SDK connected</span><strong>{browserLabel}</strong><small>{browserInfo ? `${browserInfo.operatingSystem} · ${browserInfo.deviceType} · ${browserInfo.engine}` : "Waiting for browser details"}</small><p>This exact browser will be attached to every new event.</p></div>
        </div>

        <div className="checkout-layout">
          <div className="order-card">
            <span className="card-label">YOUR ORDER</span>
            {cartProduct ? <><div className={`mini-product ${cartProduct.color}`}>01</div><h3>{cartProduct.name}</h3><p>{cartProduct.description}</p><strong>{cartProduct.priceLabel}</strong></> : <div className="empty-cart"><b>Bag is empty</b><p>Add any product above.</p></div>}
          </div>

          <form className="checkout-card" onSubmit={handleCheckout}>
            <div className="field-row"><label>Customer ID<input value={customerId} onChange={(event) => setCustomerId(event.target.value)} /></label><label>Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}><option>bKash</option><option>Card</option><option>Cash on delivery</option></select></label></div>
            <label>Sandbox backend outcome<select value={scenario} onChange={(event) => setScenario(event.target.value as CheckoutScenario)}>{scenarios.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><small>{selectedScenario.result}</small></label>
            <button className="pay-button" disabled={!cartProduct || processing}>{processing ? "Contacting checkout API…" : cartProduct ? `Pay ${cartProduct.priceLabel}` : "Add a product first"}</button>
            <div className={`checkout-notice ${noticeKind}`}><i />{notice}</div>
          </form>
        </div>
      </section>

      <section className="test-suite" id="test-suite">
        <div className="suite-heading"><p className="eyebrow">RELIABILITY TEST SUITE</p><h2>Prove the monitoring system works.</h2><p>Run these after the checkout scenarios, then verify the expected result on the dashboard.</p></div>
        <div className="test-grid">
          <article><span>01 · GROUPING</span><h3>Same failure × 5</h3><p>One issue should contain five occurrences instead of creating five duplicate issues.</p><button disabled={Boolean(suiteRunning)} onClick={() => void runGroupingTest()}>{suiteRunning === "grouping" ? "Running…" : "Run grouping test"}</button></article>
          <article><span>02 · USERS</span><h3>Five affected customers</h3><p>One shared issue should show five events and five unique affected users.</p><button disabled={Boolean(suiteRunning)} onClick={() => void runMultiUserTest()}>{suiteRunning === "users" ? "Running…" : "Run multi-user test"}</button></article>
          <article><span>03 · PRIVACY</span><h3>Secret-field redaction</h3><p>Password, card number, and access token must become [Redacted]; the safe note remains.</p><button disabled={Boolean(suiteRunning)} onClick={() => void runPrivacyTest()}>{suiteRunning === "privacy" ? "Running…" : "Run privacy test"}</button></article>
          <article className="manual-test"><span>04 · REGRESSION</span><h3>Resolved error returns</h3><p>Run one checkout failure, resolve it in the dashboard, then run the same failure again. It should become regressed.</p><a href={dashboardUrl} target="_blank" rel="noreferrer">Open dashboard ↗</a></article>
          <article className="manual-test"><span>05 · BROWSERS</span><h3>Real Chrome + Brave</h3><p>Open this shop separately in each browser and run the same scenario. Recent event browsers should list both.</p><a href="#demo">See detected browser ↑</a></article>
          <article className="manual-test"><span>06 · SUCCESS PATH</span><h3>No false alarm</h3><p>Choose Successful payment. An order should be created and CrashLens should receive no error.</p><a href="#demo">Run successful checkout ↑</a></article>
        </div>
      </section>
    </main>
  );
}
