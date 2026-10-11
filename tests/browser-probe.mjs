import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
const browser = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: 'shell' });
const page = await browser.newPage();
await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0' });
console.log('title:', await page.title());
await browser.close();
