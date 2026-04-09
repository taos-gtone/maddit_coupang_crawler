/**
 * 쿠팡 전체 카테고리 트리 수집
 *
 * 2가지 방식으로 탐색:
 *   A) Network API 가로채기 — 쿠팡 내부 카테고리 JSON API
 *   B) DOM 탐색 — GNB 메뉴 + 사이드바 카테고리 트리
 *
 * 결과: data/categories.json (레벨별 명칭 + URL)
 *
 * 사용법:
 *   1) start-chrome.bat으로 Chrome 실행
 *   2) node src/categories-crawl.js
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

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

  console.log("=".repeat(60));
  console.log("쿠팡 전체 카테고리 수집");
  console.log("=".repeat(60));

  // ── 방법 A) Network API 가로채기 ──
  console.log("\n[방법 A] Network API 탐색...");

  const apiResponses = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (
      url.includes("category") ||
      url.includes("gnb") ||
      url.includes("menu") ||
      url.includes("navigation")
    ) {
      try {
        const contentType = response.headers()["content-type"] || "";
        if (contentType.includes("json")) {
          const body = await response.json();
          apiResponses.push({ url, body });
          console.log(`  API 발견: ${url.slice(0, 100)}`);
        }
      } catch {}
    }
  });

  // 쿠팡 메인 접속 (GNB 로드 트리거)
  await page.goto("https://www.coupang.com", { waitUntil: "load", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));

  // GNB 햄버거 메뉴 클릭 시도 (카테고리 API 호출 트리거)
  try {
    const menuBtn = await page.$(
      "[class*='hamburger'], [class*='gnb'], [class*='menu-btn'], " +
      "[class*='category-btn'], button[aria-label*='카테고리'], " +
      "[class*='Hamburger'], [class*='Menu']"
    );
    if (menuBtn) {
      console.log("  메뉴 버튼 클릭...");
      await menuBtn.click();
      await new Promise((r) => setTimeout(r, 3000));
    }
  } catch {}

  // 카테고리 전체보기 페이지로 이동
  console.log("  카테고리 전체보기 페이지 로드...");
  await page.goto("https://www.coupang.com/np/categories/393760", {
    waitUntil: "load",
    timeout: 30000,
  });
  await new Promise((r) => setTimeout(r, 3000));

  // API 결과 저장
  if (apiResponses.length > 0) {
    const apiPath = join(DATA_DIR, "categories-api-raw.json");
    writeFileSync(apiPath, JSON.stringify(apiResponses, null, 2), "utf-8");
    console.log(`  API 응답 ${apiResponses.length}개 저장: ${apiPath}`);
  }

  // ── 방법 B) DOM에서 카테고리 추출 ──
  console.log("\n[방법 B] DOM에서 카테고리 추출...");

  // B-1) 쿠팡 메인의 GNB 전체 카테고리 메뉴
  await page.goto("https://www.coupang.com", { waitUntil: "load", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));

  // 햄버거 메뉴 열기
  try {
    const triggers = [
      "[class*='hamburger']",
      "[class*='category']",
      "[class*='gnb'] button",
      "[class*='Hamburger']",
      "button[aria-label*='메뉴']",
      "button[aria-label*='카테고리']",
    ];
    for (const sel of triggers) {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        await new Promise((r) => setTimeout(r, 2000));
        break;
      }
    }
  } catch {}

  // DOM에서 카테고리 링크 전부 수집
  const gnbCategories = await page.evaluate(() => {
    const results = [];
    // 모든 카테고리 링크 패턴
    const links = document.querySelectorAll(
      "a[href*='/np/categories/'], a[href*='/np/coupangglobal/'], " +
      "[class*='category'] a, [class*='menu'] a[href*='categories'], " +
      "[class*='Category'] a, [class*='gnb'] a"
    );

    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const name = link.textContent?.trim() || "";
      if (!name || name.length < 1 || !href.includes("categor")) continue;

      let url = href;
      if (url.startsWith("/")) url = "https://www.coupang.com" + url;

      // 카테고리 ID 추출
      const idMatch = url.match(/categories\/(\d+)/);
      const id = idMatch ? idMatch[1] : "";

      // depth 추정 (DOM 중첩 레벨)
      let depth = 0;
      let parent = link.parentElement;
      for (let i = 0; i < 10 && parent; i++) {
        if (
          parent.tagName === "UL" ||
          parent.tagName === "OL" ||
          parent.classList?.toString().includes("sub")
        ) {
          depth++;
        }
        parent = parent.parentElement;
      }

      results.push({ name, url, id, depth });
    }

    return results;
  });

  console.log(`  GNB 메뉴에서 ${gnbCategories.length}개 카테고리 발견`);

  // B-2) 각 대분류 카테고리 페이지의 사이드바에서 하위 카테고리 수집
  console.log("\n[하위 카테고리 수집] 대분류별 사이드바 탐색...");

  // 대분류 카테고리 (depth가 낮고 고유한 것들)
  const seen = new Set();
  const topCategories = gnbCategories.filter((c) => {
    if (!c.id || seen.has(c.id)) return false;
    seen.add(c.id);
    return c.depth <= 1;
  });

  console.log(`  대분류 ${topCategories.length}개 탐색 예정\n`);

  const allCategories = [];

  // 이미 수집한 것 추가 (레벨 1)
  for (const cat of topCategories) {
    allCategories.push({ ...cat, level: 1 });
  }

  // 각 대분류의 사이드바에서 하위 카테고리 수집
  for (let i = 0; i < topCategories.length; i++) {
    const top = topCategories[i];
    console.log(`  [${i + 1}/${topCategories.length}] ${top.name} (${top.url})`);

    try {
      await page.goto(top.url, { waitUntil: "load", timeout: 20000 });
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));

      // 사이드바 카테고리 추출
      const subCategories = await page.evaluate((parentId) => {
        const results = [];

        // 사이드바/좌측 메뉴의 카테고리 링크
        const selectors = [
          "[class*='side'] a[href*='categories']",
          "[class*='Side'] a[href*='categories']",
          "[class*='filter'] a[href*='categories']",
          "[class*='category-tree'] a",
          "[class*='nav'] a[href*='categories']",
          "[class*='lnb'] a[href*='categories']",
          "a[href*='/np/categories/']",
        ];

        const allLinks = new Set();
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach((el) => allLinks.add(el));
        }

        for (const link of allLinks) {
          const href = link.getAttribute("href") || "";
          const name = link.textContent?.trim() || "";
          if (!name || !href.includes("categor")) continue;

          let url = href;
          if (url.startsWith("/")) url = "https://www.coupang.com" + url;

          const idMatch = url.match(/categories\/(\d+)/);
          const id = idMatch ? idMatch[1] : "";

          // 부모 카테고리는 건너뛰기
          if (id === parentId) return;

          // depth: 들여쓰기/중첩 레벨로 추정
          let depth = 0;
          let parent = link.parentElement;
          for (let i = 0; i < 10 && parent; i++) {
            const cls = parent.classList?.toString() || "";
            if (
              parent.tagName === "UL" ||
              cls.includes("sub") ||
              cls.includes("child") ||
              cls.includes("depth")
            ) {
              depth++;
            }
            parent = parent.parentElement;
          }

          results.push({ name, url, id, depth });
        }

        // 중복 제거
        const seen = new Set();
        return results.filter((r) => {
          if (seen.has(r.id)) return false;
          seen.add(r.id);
          return true;
        });
      }, top.id);

      console.log(`    → ${subCategories.length}개 하위 카테고리`);

      for (const sub of subCategories) {
        // 이미 있는지 확인
        if (!allCategories.find((c) => c.id === sub.id)) {
          allCategories.push({
            ...sub,
            level: sub.depth <= 0 ? 2 : sub.depth + 1,
            parentId: top.id,
            parentName: top.name,
          });
        }
      }

      // 다음 대분류 전 대기
      if (i < topCategories.length - 1) {
        const wait = 3 + Math.floor(Math.random() * 5);
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
    } catch (err) {
      console.error(`    실패: ${err.message}`);
    }
  }

  // ── 결과 정리 ──
  // 중복 제거 (id 기준)
  const uniqueMap = new Map();
  for (const cat of allCategories) {
    if (!uniqueMap.has(cat.id) || cat.level > (uniqueMap.get(cat.id).level || 0)) {
      uniqueMap.set(cat.id, cat);
    }
  }
  const finalCategories = [...uniqueMap.values()].sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    return a.name.localeCompare(b.name, "ko");
  });

  // ── 출력 ──
  console.log("\n" + "=".repeat(60));
  console.log(`총 ${finalCategories.length}개 카테고리 수집 완료`);
  console.log("=".repeat(60));

  // 레벨별 통계
  const levelCounts = {};
  for (const cat of finalCategories) {
    levelCounts[cat.level] = (levelCounts[cat.level] || 0) + 1;
  }
  console.log("\n[레벨별 카테고리 수]");
  for (const [level, count] of Object.entries(levelCounts)) {
    console.log(`  레벨 ${level}: ${count}개`);
  }

  // 전체 트리 출력
  console.log("\n[카테고리 전체 목록]");
  finalCategories.forEach((cat) => {
    const indent = "  ".repeat(cat.level);
    const parent = cat.parentName ? ` (← ${cat.parentName})` : "";
    console.log(`${indent}[Lv${cat.level}] ${cat.name}${parent}`);
    console.log(`${indent}     ${cat.url}`);
  });

  // ── 파일 저장 ──
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  const output = {
    crawledAt: new Date().toISOString(),
    totalCategories: finalCategories.length,
    levelCounts,
    categories: finalCategories,
  };

  const outputPath = join(DATA_DIR, "categories.json");
  writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`\n저장: ${outputPath}`);

  // 간단한 CSV도 저장
  const csvLines = ["level,id,name,url,parentName"];
  for (const cat of finalCategories) {
    csvLines.push(
      `${cat.level},${cat.id},"${cat.name}",${cat.url},"${cat.parentName || ""}"`
    );
  }
  const csvPath = join(DATA_DIR, "categories.csv");
  writeFileSync(csvPath, "\uFEFF" + csvLines.join("\n"), "utf-8");
  console.log(`저장: ${csvPath} (엑셀에서 열기 가능)`);

  await page.close();
  browser.close();
  console.log("\n완료!");
}

main().catch(console.error);
