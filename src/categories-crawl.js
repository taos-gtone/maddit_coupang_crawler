/**
 * 쿠팡 전체 카테고리 트리 수집 v4
 *
 * 전략: 좌측 카테고리 메뉴의 3열 구조를 hover로 탐색
 *   1열(대분류): 패션의류/잡화, 뷰티, 출산/유아동, 식품...
 *   2열(중분류): 대분류 hover 시 나타남
 *   3열(소분류): 중분류 hover 시 나타남
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
  console.log("쿠팡 전체 카테고리 수집 v4 (3열 메뉴 hover)");
  console.log("=".repeat(60));

  // ── 1) 쿠팡 메인 접속 ──
  console.log("\n쿠팡 메인 접속...");
  await page.goto("https://www.coupang.com", { waitUntil: "load", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));

  // ── 2) 카테고리 메뉴 열기 ──
  console.log("카테고리 메뉴 열기...");

  // 햄버거 메뉴 or "카테고리" 버튼 클릭 — 여러 셀렉터 시도
  const menuOpened = await page.evaluate(() => {
    const selectors = [
      // "카테고리" 텍스트가 있는 요소
      ...document.querySelectorAll("*"),
    ];

    for (const el of selectors) {
      const text = el.textContent?.trim();
      const cls = el.className?.toString() || "";

      // "카테고리" 버튼 찾기
      if (
        (text === "카테고리" || text === "전체카테고리") &&
        (el.tagName === "BUTTON" || el.tagName === "A" || el.tagName === "SPAN" || el.tagName === "DIV") &&
        el.offsetWidth > 0
      ) {
        el.click();
        return `clicked: ${el.tagName}.${cls.slice(0, 50)} "${text}"`;
      }
    }

    // 햄버거 아이콘 (≡) 찾기
    for (const el of document.querySelectorAll("button, a, div, span")) {
      const cls = el.className?.toString() || "";
      if (
        (cls.includes("hamburger") || cls.includes("Hamburger") ||
         cls.includes("category") || cls.includes("Category") ||
         cls.includes("gnb") || cls.includes("menu-icon")) &&
        el.offsetWidth > 0
      ) {
        el.click();
        return `clicked: ${el.tagName}.${cls.slice(0, 50)}`;
      }
    }

    return null;
  });

  if (menuOpened) {
    console.log(`  ${menuOpened}`);
  } else {
    console.log("  자동 클릭 실패 — 수동 클릭 시도 (좌상단 영역)");
    // 좌상단 햄버거 위치를 직접 클릭
    await page.mouse.click(45, 42);
  }

  await new Promise((r) => setTimeout(r, 2000));

  // ── 3) 대분류(1열) 항목 수집 ──
  console.log("\n[1단계] 대분류 수집...");

  const level1Items = await page.evaluate(() => {
    const items = [];

    // 카테고리 메뉴가 열린 후 보이는 모든 링크에서 대분류 후보 찾기
    const allLinks = document.querySelectorAll("a[href*='/np/categories/']");

    for (const link of allLinks) {
      const rect = link.getBoundingClientRect();
      // 화면에 보이고, 왼쪽 열에 있는 것 (x가 작은 것)
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.x > 200) continue; // 왼쪽 열만

      const name = link.textContent?.replace(/\s+/g, " ").trim();
      const href = link.getAttribute("href") || "";
      if (!name || name.length < 2) continue;

      const idMatch = href.match(/categories\/(\d+)/);
      const id = idMatch ? idMatch[1] : "";

      items.push({
        name,
        url: href.startsWith("/") ? "https://www.coupang.com" + href : href,
        id,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        width: rect.width,
        height: rect.height,
      });
    }

    // x 기준으로 가장 왼쪽에 있는 그룹만 필터
    if (items.length > 0) {
      const minX = Math.min(...items.map((i) => i.x));
      return items.filter((i) => Math.abs(i.x - minX) < 100);
    }

    return items;
  });

  // 대분류를 못 찾았으면 전체 보이는 카테고리 링크로 재시도
  if (level1Items.length === 0) {
    console.log("  왼쪽 열 필터 실패 — 전체 카테고리 링크에서 재시도");

    const allVisibleLinks = await page.evaluate(() => {
      const items = [];
      const links = document.querySelectorAll("a[href*='/np/categories/']");
      for (const link of links) {
        const rect = link.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        const name = link.textContent?.replace(/\s+/g, " ").trim();
        const href = link.getAttribute("href") || "";
        if (!name || name.length < 2 || name.length > 20) continue;

        const idMatch = href.match(/categories\/(\d+)/);
        items.push({
          name,
          url: href.startsWith("/") ? "https://www.coupang.com" + href : href,
          id: idMatch ? idMatch[1] : "",
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          width: rect.width,
          height: rect.height,
        });
      }
      return items;
    });

    // 중복 이름 제거, y좌표순 정렬
    const seen = new Set();
    for (const item of allVisibleLinks.sort((a, b) => a.y - b.y)) {
      if (!seen.has(item.name) && level1Items.length < 25) {
        seen.add(item.name);
        level1Items.push(item);
      }
    }
  }

  console.log(`  대분류 ${level1Items.length}개 발견:`);
  level1Items.forEach((item, i) => {
    console.log(`    ${i + 1}. ${item.name} (x:${Math.round(item.x)}, y:${Math.round(item.y)})`);
  });

  // ── 4) 각 대분류 hover → 중분류(2열) 수집 ──
  console.log("\n[2단계] 대분류 hover → 중분류 수집...");

  const allCategories = [];

  // 대분류 추가
  for (const item of level1Items) {
    allCategories.push({
      level: 1,
      name: item.name,
      url: item.url,
      id: item.id,
      parentId: null,
      parentName: null,
    });
  }

  for (let i = 0; i < level1Items.length; i++) {
    const parent = level1Items[i];
    console.log(`\n  [${i + 1}/${level1Items.length}] "${parent.name}" hover...`);

    // 대분류 항목에 마우스 hover
    await page.mouse.move(parent.x, parent.y, { steps: 3 });
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 500));

    // hover 후 나타난 2열(중분류) 항목 수집
    const level2Items = await page.evaluate((parentX) => {
      const items = [];
      const links = document.querySelectorAll("a[href*='/np/categories/']");

      for (const link of links) {
        const rect = link.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        // 2열: 대분류보다 오른쪽, 소분류보다 왼쪽
        if (rect.x <= parentX + 50) continue; // 1열 제외
        if (rect.x > 350) continue; // 3열 제외 (대략)

        const name = link.textContent?.replace(/\s+/g, " ").trim();
        const href = link.getAttribute("href") || "";
        if (!name || name.length < 2) continue;

        const idMatch = href.match(/categories\/(\d+)/);
        items.push({
          name,
          url: href.startsWith("/") ? "https://www.coupang.com" + href : href,
          id: idMatch ? idMatch[1] : "",
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        });
      }

      // x 기준 같은 열만 필터
      if (items.length > 0) {
        const midX = items.reduce((s, i) => s + i.x, 0) / items.length;
        return items.filter((i) => Math.abs(i.x - midX) < 80);
      }
      return items;
    }, parent.x);

    // 중복 제거
    const seen2 = new Set(allCategories.map((c) => c.id));
    const newLevel2 = level2Items.filter((item) => item.id && !seen2.has(item.id));

    for (const item of newLevel2) {
      allCategories.push({
        level: 2,
        name: item.name,
        url: item.url,
        id: item.id,
        parentId: parent.id,
        parentName: parent.name,
      });
    }

    console.log(`    중분류 ${newLevel2.length}개: ${newLevel2.map((i) => i.name).join(", ")}`);

    // ── 5) 각 중분류 hover → 소분류(3열) 수집 ──
    for (let j = 0; j < level2Items.length; j++) {
      const mid = level2Items[j];

      // 중분류에 hover
      await page.mouse.move(mid.x, mid.y, { steps: 3 });
      await new Promise((r) => setTimeout(r, 500 + Math.random() * 300));

      // 3열(소분류) 수집
      const level3Items = await page.evaluate((midX) => {
        const items = [];
        const links = document.querySelectorAll("a[href*='/np/categories/']");

        for (const link of links) {
          const rect = link.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          // 3열: 중분류보다 더 오른쪽
          if (rect.x <= midX + 30) continue;

          const name = link.textContent?.replace(/\s+/g, " ").trim();
          const href = link.getAttribute("href") || "";
          if (!name || name.length < 2) continue;

          const idMatch = href.match(/categories\/(\d+)/);
          items.push({
            name,
            url: href.startsWith("/") ? "https://www.coupang.com" + href : href,
            id: idMatch ? idMatch[1] : "",
          });
        }
        return items;
      }, mid.x);

      const seen3 = new Set(allCategories.map((c) => c.id));
      const newLevel3 = level3Items.filter((item) => item.id && !seen3.has(item.id));

      for (const item of newLevel3) {
        allCategories.push({
          level: 3,
          name: item.name,
          url: item.url,
          id: item.id,
          parentId: mid.id,
          parentName: mid.name,
        });
      }

      if (newLevel3.length > 0) {
        console.log(`      ${mid.name} → 소분류 ${newLevel3.length}개: ${newLevel3.map((i) => i.name).join(", ")}`);
      }
    }
  }

  // ── 결과 정리 ──
  // 중복 제거 (id 기준)
  const uniqueMap = new Map();
  for (const cat of allCategories) {
    if (!uniqueMap.has(cat.id)) {
      uniqueMap.set(cat.id, cat);
    }
  }
  const sorted = [...uniqueMap.values()].sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    return a.name.localeCompare(b.name, "ko");
  });

  const levelCounts = {};
  for (const cat of sorted) {
    levelCounts[cat.level] = (levelCounts[cat.level] || 0) + 1;
  }

  // ── 출력 ──
  console.log("\n" + "=".repeat(60));
  console.log(`총 ${sorted.length}개 카테고리 수집 완료`);
  console.log("=".repeat(60));

  console.log("\n[레벨별]");
  for (const [level, count] of Object.entries(levelCounts).sort()) {
    const label = level === "1" ? "대분류" : level === "2" ? "중분류" : "소분류";
    console.log(`  레벨 ${level} (${label}): ${count}개`);
  }

  console.log("\n[전체 트리]");
  let currentParent = "";
  sorted.forEach((cat) => {
    const indent = "  ".repeat(cat.level);
    if (cat.level === 1) {
      console.log("");
    }
    const parent = cat.parentName && cat.level > 1 ? ` (← ${cat.parentName})` : "";
    console.log(`${indent}[Lv${cat.level}] ${cat.name}${parent}`);
    console.log(`${indent}      ${cat.url}`);
  });

  // ── 파일 저장 ──
  const output = {
    crawledAt: new Date().toISOString(),
    totalCategories: sorted.length,
    levelCounts,
    categories: sorted,
  };

  const jsonPath = join(DATA_DIR, "categories.json");
  writeFileSync(jsonPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`\n저장: ${jsonPath}`);

  const csvLines = ["level,id,name,url,parentId,parentName"];
  for (const cat of sorted) {
    const safeName = cat.name.replace(/"/g, '""');
    const safeParent = (cat.parentName || "").replace(/"/g, '""');
    csvLines.push(
      `${cat.level},${cat.id},"${safeName}",${cat.url},${cat.parentId || ""},"${safeParent}"`
    );
  }
  const csvPath = join(DATA_DIR, "categories.csv");
  writeFileSync(csvPath, "\uFEFF" + csvLines.join("\n"), "utf-8");
  console.log(`저장: ${csvPath}`);

  await page.close();
  browser.close();
  console.log("\n완료!");
}

main().catch(console.error);
