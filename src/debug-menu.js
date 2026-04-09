/**
 * 카테고리 메뉴 DOM 구조 디버깅
 * "패션의류/잡화" hover 후 2열 영역의 실제 HTML 구조를 덤프
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data", "debug");

async function main() {
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const context = browser.contexts()[0];
  const page = await context.newPage();

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  // 쿠팡 메인
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

  // "패션의류/잡화" 찾아서 hover
  const fashion = await page.evaluate(() => {
    for (const a of document.querySelectorAll("a")) {
      if (a.textContent?.trim().includes("패션의류")) {
        const rect = a.getBoundingClientRect();
        if (rect.width > 0) return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
    }
    return null;
  });

  if (fashion) {
    await page.mouse.move(fashion.x, fashion.y, { steps: 5 });
    await new Promise((r) => setTimeout(r, 1500));
  }

  // HTML에서 "럭셔리" 텍스트 검색
  const html = await page.content();
  console.log("\n=== '럭셔리' 검색 (HTML) ===");
  let luxIdx = html.indexOf("럭셔리");
  let luxCount = 0;
  while (luxIdx >= 0) {
    luxCount++;
    const around = html.slice(Math.max(0, luxIdx - 300), luxIdx + 300);
    console.log(`\n[${luxCount}] 위치: ${luxIdx}`);
    console.log(around.slice(0, 200));
    writeFileSync(join(DATA_DIR, `luxury-${luxCount}.html`), around, "utf-8");
    luxIdx = html.indexOf("럭셔리", luxIdx + 1);
  }
  if (luxCount === 0) {
    console.log("'럭셔리' 텍스트를 HTML에서 찾을 수 없음!");
    console.log("→ hover만으로는 DOM에 로드되지 않는 것으로 추정");
  } else {
    console.log(`\n총 ${luxCount}개 발견`);
  }

  // 2열 메뉴 컨테이너 구조 확인
  console.log("\n=== 2열 메뉴 컨테이너 분석 ===");
  const containerInfo = await page.evaluate(() => {
    // "여성패션" 링크를 찾고 부모를 타고 올라가며 분석
    for (const a of document.querySelectorAll("a[href*='/np/categories/']")) {
      if (a.textContent?.trim() !== "여성패션") continue;
      const rect = a.getBoundingClientRect();
      if (rect.width === 0) continue;

      let p = a.parentElement;
      const chain = [];
      while (p && p.tagName !== "BODY") {
        const pr = p.getBoundingClientRect();
        const style = getComputedStyle(p);
        const childLinks = p.querySelectorAll("a[href*='/np/categories/']").length;
        chain.push({
          tag: p.tagName,
          class: p.className?.toString().slice(0, 80),
          childLinks,
          scrollH: p.scrollHeight,
          clientH: p.clientHeight,
          scrollable: p.scrollHeight > p.clientHeight + 5,
          overflow: style.overflow,
          overflowY: style.overflowY,
          display: style.display,
          w: Math.round(pr.width),
          h: Math.round(pr.height),
        });
        p = p.parentElement;
      }
      return chain;
    }
    return [];
  });

  console.log("\n여성패션의 부모 체인:");
  containerInfo.forEach((c, i) => {
    const scroll = c.scrollable ? " ★SCROLLABLE★" : "";
    console.log(`  ${"  ".repeat(i)}${c.tag}.${c.class} — links:${c.childLinks} scrollH:${c.scrollH} clientH:${c.clientH} overflow:${c.overflowY}${scroll}`);
  });
  writeFileSync(join(DATA_DIR, "container-chain.json"), JSON.stringify(containerInfo, null, 2), "utf-8");

  // "패션의류/잡화"의 LI 안에 있는 모든 카테고리 링크 덤프
  console.log("\n=== LI.fashion 내부 전체 링크 ===");
  const fashionLinks = await page.evaluate(() => {
    const fashionLi = document.querySelector("li.fashion");
    if (!fashionLi) return { found: false };

    const allLinks = [];
    fashionLi.querySelectorAll("a[href*='/np/categories/']").forEach((a) => {
      const href = a.getAttribute("href") || "";
      const name = a.textContent?.replace(/\s+/g, " ").trim();
      const rect = a.getBoundingClientRect();
      const parent = a.closest("ul");
      allLinks.push({
        name,
        href,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        parentUlClass: parent?.className,
        parentUlChildCount: parent?.children.length,
      });
    });

    // UL 목록도 확인
    const uls = [];
    fashionLi.querySelectorAll("ul").forEach((ul) => {
      const rect = ul.getBoundingClientRect();
      uls.push({
        class: ul.className,
        childCount: ul.children.length,
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        links: ul.querySelectorAll("a[href*='/np/categories/']").length,
      });
    });

    return {
      found: true,
      totalLinks: allLinks.length,
      links: allLinks,
      uls,
      outerHTML: fashionLi.innerHTML.slice(0, 3000),
    };
  });

  if (fashionLinks.found) {
    console.log(`  총 링크: ${fashionLinks.totalLinks}개`);
    console.log("\n  UL 목록:");
    fashionLinks.uls.forEach((ul, i) => {
      console.log(`    [${i}] UL.${ul.class} — children:${ul.childCount} links:${ul.links} ${ul.w}x${ul.h}`);
    });
    console.log("\n  링크 목록:");
    fashionLinks.links.forEach((l, i) => {
      console.log(`    ${i + 1}. "${l.name}" x:${l.x} y:${l.y} ${l.w}x${l.h} (UL.${l.parentUlClass})`);
    });
    writeFileSync(join(DATA_DIR, "fashion-li.html"), fashionLinks.outerHTML, "utf-8");
    console.log("\n  HTML 저장: data/debug/fashion-li.html");
  } else {
    console.log("  li.fashion 못 찾음");
  }

  // "여성패션" 링크와 "럭셔리패션" 링크의 DOM 위치 비교
  console.log("\n=== 여성패션 vs 럭셔리패션 DOM 구조 ===");
  const domInfo = await page.evaluate(() => {
    const result = { 여성패션: null, 럭셔리패션: null };

    for (const a of document.querySelectorAll("a[href*='/np/categories/']")) {
      const name = a.textContent?.trim();
      if (name === "여성패션" || name === "럭셔리패션") {
        const rect = a.getBoundingClientRect();
        // 부모 체인
        const parents = [];
        let p = a;
        for (let i = 0; i < 8 && p; i++) {
          const pr = p.getBoundingClientRect();
          parents.push({
            tag: p.tagName,
            class: p.className?.toString().slice(0, 80),
            id: p.id,
            w: Math.round(pr.width),
            h: Math.round(pr.height),
            overflow: getComputedStyle(p).overflow,
          });
          p = p.parentElement;
        }
        result[name] = {
          href: a.getAttribute("href"),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          display: getComputedStyle(a).display,
          visibility: getComputedStyle(a).visibility,
          parents,
        };
      }
    }
    return result;
  });

  console.log("\n여성패션:", JSON.stringify(domInfo["여성패션"], null, 2));
  console.log("\n럭셔리패션:", JSON.stringify(domInfo["럭셔리패션"], null, 2));

  writeFileSync(join(DATA_DIR, "menu-dom.json"), JSON.stringify(domInfo, null, 2), "utf-8");
  console.log("\n저장: data/debug/menu-dom.json");

  await page.close();
  browser.close();
}

main().catch(console.error);
