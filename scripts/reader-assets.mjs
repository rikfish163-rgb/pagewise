import {cpSync, mkdirSync} from "node:fs";
import path from "node:path";
const base="node_modules/pdfjs-dist";
mkdirSync("public/pdfjs",{recursive:true});
cpSync(path.join(base,"build/pdf.worker.min.mjs"),"public/pdf.worker.min.mjs");
for(const dir of ["cmaps","standard_fonts","wasm"]) cpSync(path.join(base,dir),path.join("public/pdfjs",dir),{recursive:true});
