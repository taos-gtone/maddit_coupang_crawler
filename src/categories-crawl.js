/**
 * 쿠팡 전체 카테고리 트리 수집 v9
 *
 * 전략: DOM 구조 직접 탐색 (hover + x좌표 추정 제거)
 *
 * 쿠팡 카테고리 메뉴 DOM 구조:
 *   UL.menu.shopping-menu-list
 *     LI.fashion (대분류)
 *       A (대분류 링크 — /np/categories/ 또는 다른 경로)
 *       DIV.depth
 *         UL.sdl (중분류 리스트)
 *           LI
 *             A (중분류 링크 — /np/categories/ 또는 /np/campaigns/)
 *             UL.tdl (소분류 리스트)
 *               LI > A (소분류 링크)
 *
 * 사용법:
 *   node src/categories-crawl.js
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

const EXCLUDE_NAMES = [
  "더보기", "입점/판매 신청", "입점/판매신청",
];

async function main() {
  let browser;
  try {
    browser = await chromium.connectOverCDP("http://localhost:9222");
  } catch {
    console.error("Chrome 연결 실패! start-chrome.bat을 먼저 실행하세요.");
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const page = await context.newPage();

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  console.log("=".repeat(60));
  console.log("쿠팡 전체 카테고리 수집 v9 (DOM 구조 직접 탐색)");
  console.log("=".repeat(60));

  // ── 1) 쿠팡 메인 접속 ──
  console.log("\n쿠팡 메인 접속...");
  await page.goto("https://www.coupang.com", { waitUntil: "load", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));

  // ── 2) 햄버거 hover → 메뉴 로드 ──
  console.log("카테고리 메뉴에 마우스오버...");

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

  // ── 3) DOM에서 전체 카테고리 트리 한번에 추출 ──
  console.log("\nDOM에서 카테고리 트리 추출...");

  const tree = await page.evaluate(({ excludeNames }) => {
    const result = [];

    // UL.menu.shopping-menu-list 안의 모든 대분류 LI
    const menuUl = document.querySelector("ul.menu.shopping-menu-list");
    if (!menuUl) return result;

    const topLis = menuUl.querySelectorAll(":scope > li");

    for (const topLi of topLis) {
      // 대분류 링크 (첫 번째 <a>)
      const topLink = topLi.querySelector(":scope > a");
      if (!topLink) continue;

      const topName = topLink.textContent?.replace(/\s+/g, " ").trim();
      if (!topName || topName.length < 2) continue;
      if (excludeNames.some((ex) => topName.includes(ex))) continue;

      const topHref = topLink.getAttribute("href") || "";
      let topUrl = topHref;
      if (topUrl.startsWith("/")) topUrl = "https://www.coupang.com" + topUrl;

      const topCat = {
        level: 1,
        name: topName,
        url: topUrl,
        children: [],
      };

      // 중분류: UL.sdl > LI > A
      const sdl = topLi.querySelector("ul.sdl");
      if (sdl) {
        const midLis = sdl.querySelectorAll(":scope > li");

        for (const midLi of midLis) {
          const midLink = midLi.querySelector(":scope > a");
          if (!midLink) continue;

          const midName = midLink.textContent?.replace(/\s+/g, " ").trim();
          if (!midName || midName.length < 2) continue;
          if (excludeNames.some((ex) => midName.includes(ex))) continue;

          const midHref = midLink.getAttribute("href") || "";
          let midUrl = midHref;
          if (midUrl.startsWith("/")) midUrl = "https://www.coupang.com" + midUrl;

          const midCat = {
            level: 2,
            name: midName,
            url: midUrl,
            children: [],
          };

          // 소분류: UL.tdl > LI > A
          const tdl = midLi.querySelector("ul.tdl");
          if (tdl) {
            const smallLis = tdl.querySelectorAll(":scope > li");

            for (const smallLi of smallLis) {
              const smallLink = smallLi.querySelector(":scope > a");
              if (!smallLink) continue;

              const smallName = smallLink.textContent?.replace(/\s+/g, " ").trim();
              if (!smallName || smallName.length < 2) continue;
              if (excludeNames.some((ex) => smallName.includes(ex))) continue;

              const smallHref = smallLink.getAttribute("href") || "";
              let smallUrl = smallHref;
              if (smallUrl.startsWith("/")) smallUrl = "https://www.coupang.com" + smallUrl;

              midCat.children.push({
                level: 3,
                name: smallName,
                url: smallUrl,
              });
            }
          }

          topCat.children.push(midCat);
        }
      }

      result.push(topCat);
    }

    return result;
  }, { excludeNames: EXCLUDE_NAMES });

  // ── 결과 플랫 배열로 변환 ──
  const allCategories = [];

  for (const top of tree) {
    allCategories.push({ level: 1, name: top.name, url: top.url, parentName: null });

    for (const mid of top.children) {
      allCategories.push({ level: 2, name: mid.name, url: mid.url, parentName: top.name });

      for (const small of mid.children) {
        allCategories.push({ level: 3, name: small.name, url: small.url, parentName: mid.name });
      }
    }
  }

  // ── 통계 ──
  const levelCounts = {};
  for (const cat of allCategories) {
    levelCounts[cat.level] = (levelCounts[cat.level] || 0) + 1;
  }

  console.log("\n" + "=".repeat(60));
  console.log(`총 ${allCategories.length}개 카테고리 수집 완료`);
  console.log("=".repeat(60));

  console.log("\n[레벨별]");
  for (const [level, count] of Object.entries(levelCounts).sort()) {
    const label = level === "1" ? "대분류" : level === "2" ? "중분류" : "소분류";
    console.log(`  레벨 ${level} (${label}): ${count}개`);
  }

  // ── 트리 출력 ──
  console.log("\n[카테고리 트리]");

  for (const top of tree) {
    console.log(`${top.name}\t${top.url}`);

    for (const mid of top.children) {
      console.log(`\t${mid.name}\t${mid.url}`);

      for (const small of mid.children) {
        console.log(`\t\t${small.name}\t${small.url}`);
      }
    }
  }

  // ── 파일 저장 ──
  const output = {
    crawledAt: new Date().toISOString(),
    totalCategories: allCategories.length,
    levelCounts,
    tree,
    categories: allCategories,
  };

  const jsonPath = join(DATA_DIR, "categories.json");
  writeFileSync(jsonPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`\n저장: ${jsonPath}`);

  const csvLines = ["level,name,url,parentName"];
  for (const cat of allCategories) {
    const safeName = cat.name.replace(/"/g, '""');
    const safeParent = (cat.parentName || "").replace(/"/g, '""');
    csvLines.push(`${cat.level},"${safeName}",${cat.url},"${safeParent}"`);
  }
  const csvPath = join(DATA_DIR, "categories.csv");
  writeFileSync(csvPath, "\uFEFF" + csvLines.join("\n"), "utf-8");
  console.log(`저장: ${csvPath}`);

  await page.close();
  browser.close();
  console.log("\n완료!");
}

main().catch(console.error);
