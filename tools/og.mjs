import { chromium } from 'playwright';
const b = await chromium.launch({executablePath:'/usr/bin/chromium'});
const p = await b.newPage({viewport:{width:1200,height:630}});
await p.goto('file://'+process.argv[2]+'/og.html'); await p.waitForTimeout(800);
await p.screenshot({path: process.argv[2]+'/../og.png'}); await b.close();
