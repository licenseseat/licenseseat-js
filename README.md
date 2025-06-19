# 💺 LicenseSeat - JavaScript SDK

Official JavaScript client for [LicenseSeat](https://licenseseat.com) – the simple, secure licensing platform for apps, games, and plugins.

This SDK helps you integrate license activation, validation, offline caching, entitlement checks, and more into your JavaScript and browser-based apps.

---

## 🚀 Installation

```bash
npm install @licenseseat/js
````

Or via `yarn`:

```bash
yarn add @licenseseat/js
```

---

## 🧪 Quickstart

```js
import LicenseSeat from '@licenseseat/js';

const license = new LicenseSeat({
  publicKey: 'LS_PUBLIC_...',
  product: 'my-app-id',
  debug: true
});

// Activate a license key
await license.activate('your-license-key');

// Check if the user is entitled to a feature
if (license.hasEntitlement('pro')) {
  // unlock features
}
```

---

## 🌐 Browser Support

This SDK works natively in:

* Modern browsers (`import` via ESM)
* Any bundler (Vite, Webpack, Rollup)
* Node.js (>= 18)

If you prefer `<script>` tag usage, you can use the [global bundle](#browser-global-usage) instead.

---

## 📦 Features

* 🔐 **License activation**
* 📍 **Device fingerprinting**
* 🌐 **Online & offline validation**
* 🎫 **Entitlements support**
* 📥 **Encrypted local caching**
* 🎯 **Auto-retry on network failure**
* 📡 **Event emitters for reactive state**
* ⚙️ **Fully ESM-compatible**

---

## 📘 API Reference

### `new LicenseSeat(options)`

| Option      | Type    | Description                                   |
| ----------- | ------- | --------------------------------------------- |
| `publicKey` | string  | Your LicenseSeat public signing key           |
| `product`   | string  | Product identifier from LicenseSeat dashboard |
| `debug`     | boolean | Optional. Logs debug info to console          |

---

### `await license.activate(licenseKey)`

Activates a license key and stores metadata.

---

### `license.hasEntitlement(entitlementName)`

Returns `true` if the current license includes the given entitlement.

---

### `await license.validate()`

Force online validation of the current license (optional).

---

### `license.on(event, callback)`

Subscribe to SDK lifecycle events:

```js
license.on('activated', (data) => {
  console.log('License activated:', data);
});

license.on('error', (err) => {
  console.error('LicenseSeat error:', err);
});
```

Supported events:

* `activated`
* `deactivated`
* `error`
* `offline`
* `validated`

---

## 💻 Browser Global Usage

To use without a build system:

```html
<script src="https://cdn.licenseseat.com/sdk/latest/index.global.js"></script>
<script>
  const license = new LicenseSeat({
    publicKey: 'LS_PUBLIC_...',
    product: 'my-app-id'
  });

  license.activate('YOUR-LICENSE');
</script>
```

*(CDN link optional — you can also host your own global bundle.)*

---

## 🛠 Development

Clone the SDK:

```bash
git clone https://github.com/licenseseat/licenseseat-js.git
cd licenseseat-js
npm install
npm run build
```

This builds `dist/index.js` (ESM) and optionally `index.global.js` (IIFE).

---

## 🧠 LicenseSeat Docs

* 📘 [Documentation](https://licenseseat.com/docs)
* 💬 [Contact support](https://licenseseat.com/contact)

---

## 🪪 License

MIT License © 2025 [LicenseSeat](https://licenseseat.com)