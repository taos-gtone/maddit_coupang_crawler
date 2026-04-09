/**
 * "럭셔리패션" 정확한 위치 탐색
 * 패션의류/잡화 hover 후 시간별로 DOM 변화 추적
 */
import { chromium } from "playwright";

async function main() {
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const context = browser.contexts()[0];
  const page = await context.newPage();

  await page.goto("https://www.coupang.com", { waitUntil: "load", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));

  // 햄버거 hover
  const menuPos = await page.evaluate(() => {
    for (const el of document.querySelectorAll("*")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) continue;
      const text = el.textContent?.trim();
      if (text?.includes("카테고리") && text.length < 15) {
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
    }
    return null;
  });

  await page.mouse.move(menuPos?.x || 45, menuPos?.y || 55, { steps: 5 });
  await new Promise((r) => setTimeout(r, 2000));

  // "패션의류/잡화" hover
  const fashion = await page.evaluate(() => {
    for (const a of document.querySelectorAll("a")) {
      if (a.textContent?.trim().includes("패션의류")) {
        const rect = a.getBoundingClientRect();
        if (rect.width > 0) return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
    }
    return null;
  });

  if (!fashion) { console.log("패션의류 못 찾음"); process.exit(1); }

  await page.mouse.move(fashion.x, fashion.y, { steps: 5 });

  // 시간별로 "럭셔리패션" 등장 여부 체크
  for (let sec = 1; sec <= 10; sec++) {
    await new Promise((r) => setTimeout(r, 1000));
    const html = await page.content();
    const hasLux = html.includes("럭셔리패션");
    const luxCount = (html.match(/럭셔리패션/g) || []).length;
    console.log(`${sec}초: 럭셔리패션 ${hasLux ? `발견! (${luxCount}개)` : "없음"}`);

    if (hasLux) {
      // 위치 찾기
      const idx = html.indexOf("럭셔리패션");
      console.log("주변 HTML:");
      console.log(html.slice(Math.max(0, idx - 300), idx + 300));
      break;
    }
  }

  // 전체 페이지 innerText에서도 검색
  const text = await page.evaluate(() => document.body.innerText);
  const hasInText = text.includes("럭셔리패션");
  console.log(`\ninnerText에서: ${hasInText ? "발견!" : "없음"}`);

  // 전체 대분류 메뉴(UL.menu) 안의 LI 목록 확인
  console.log("\n=== UL.menu 안의 LI 목록 ===");
  const menuItems = await page.evaluate(() => {
    const ul = document.querySelector("ul.menu.shopping-menu-list");
    if (!ul) return [];
    return [...ul.children].map((li, i) => ({
      index: i,
      class: li.className?.slice(0, 60),
      text: li.querySelector("a")?.textContent?.trim(),
      href: li.querySelector("a")?.getAttribute("href"),
      sdlChildren: li.querySelector("ul.sdl")?.children.length || 0,
      sdlTexts: [...(li.querySelector("ul.sdl")?.querySelectorAll(":scope > li > a") || [])].map(a => a.textContent?.trim()),
    }));
  });

  menuItems.forEach((item) => {
    console.log(`\n  [${item.index}] ${item.text} (class: ${item.class})`);
    console.log(`       href: ${item.href}`);
    console.log(`       sdl children: ${item.sdlChildren}`);
    if (item.sdlTexts.length > 0) {
      console.log(`       sdl items: ${item.sdlTexts.join(", ")}`);
    }
  });

  await page.close();
  browser.close();
}

main().catch(console.error);
