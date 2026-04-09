# sfmc-language-lsp

Protocol-agnostic, browser-compatible **language service** for Salesforce Marketing Cloud — **AMPscript**, **SSJS**, and **GTL**. It provides validation, completions, hover, signature help, and code actions.

Data comes from the [`ampscript-data`](https://www.npmjs.com/package/ampscript-data) and [`ssjs-data`](https://www.npmjs.com/package/ssjs-data) packages. Consumers include the [SFMC Language Service](https://marketplace.visualstudio.com/items?itemName=joernberkefeld.sfmc-language) VS Code extension (bundled) and the [mcp-server-sfmc](https://www.npmjs.com/package/mcp-server-sfmc) MCP server (runtime dependency).

## Install

```bash
npm install sfmc-language-lsp
```

## Build

From this package directory:

```bash
npm ci
npm run build
npm test
```

## License

MIT — see [LICENSE](./LICENSE).
