# Octoform Flow

Tiny static Svelte app for driving the GitHub App manifest flow on GitHub Pages.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The static site is emitted to `build/`.

## Query Parameters

- `owner`: GitHub owner name
- `owner_type`: `organization` or `user`
- `flow_type`: `bootstrap` or `apply`
- `payload`: URL-encoded JSON, plain JSON, or base64url-encoded JSON for `apply`

## Routes

- `/` main flow UI
- `/return/` callback handler that stores `code` values in browser local storage
