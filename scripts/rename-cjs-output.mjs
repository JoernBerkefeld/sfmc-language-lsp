// After tsc emits CommonJS under dist/cjs, rename .js outputs to .cjs and
// rewrite relative require("./x.js") -> require("./x.cjs").
// Needed when package.json has "type": "module" (plain .js is ESM).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRoot = path.join(__dirname, '..', 'dist', 'cjs');

function collectJsFiles(dir, out = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) collectJsFiles(p, out);
        else if (ent.name.endsWith('.js')) out.push(p);
    }
    return out;
}

function fixRequires(content) {
    return content.replace(/require\((['"])(\.\.?\/[^'"]+)\.js\1\)/g, 'require($1$2.cjs$1)');
}

const files = collectJsFiles(cjsRoot);
for (const jsPath of files) {
    const cjsPath = `${jsPath.slice(0, -3)}.cjs`;
    const content = fixRequires(fs.readFileSync(jsPath, 'utf8'));
    fs.writeFileSync(cjsPath, content);
    fs.unlinkSync(jsPath);
}
