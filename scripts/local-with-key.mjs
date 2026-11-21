// Run the ordinary local preview with a key held only in process memory.
import {open} from "node:fs/promises";
import {constants} from "node:fs";
import {spawn} from "node:child_process";
const source=process.env.PAGEWISE_KEY_FILE;
if(!source) throw Error("请设置 PAGEWISE_KEY_FILE 为项目专用密钥文件的路径。");
const handle=await open(source,constants.O_RDONLY|constants.O_NOFOLLOW);
let key;
try {
 const st=await handle.stat();
 if(!st.isFile()||st.size>4096) throw Error("密钥文件格式不正确。");
 key=(await handle.readFile("utf8")).trim();
 if(!/^sk-[A-Za-z0-9_-]+$/.test(key)) throw Error("密钥文件必须仅包含项目密钥。");
} finally { await handle.close(); }
// Only the named binding is injected into the local Worker, never into Vite client vars.
const child=spawn(process.execPath,["scripts/run-framework.mjs","dev","--hostname","127.0.0.1",...process.argv.slice(2)],{stdio:"inherit",env:{...process.env,OPENAI_API_KEY:key}});
for(const sig of ["SIGINT","SIGTERM"]) process.on(sig,()=>child.kill(sig));
child.on("exit",(code)=>process.exit(code??1));
