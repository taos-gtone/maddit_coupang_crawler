/**
 * 쿠팡 전체 카테고리 트리 수집 v3
 *
 * 전략 (3가지 동시 탐색):
 *   A) 페이지 내 <script> 태그의 JSON 데이터에서 카테고리 추출
 *   B) 좌측 사이드바 각 항목에 마우스 hover → 서브 메뉴 추출
 *   C) 각 대분류 페이지 접속 → HTML에서 모든 카테고리 링크 추출
 *
 * 사용법:
 *   node src/categories-crawl.js
 *   node src/categories-crawl.js --depth 3
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { depth: 2 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--depth" && args[i + 1]) opts.depth = parseInt(args[++i], 10);
  }
  return opts;
}

/** HTML 원본에서 /np/categories/ 링크 + 주변 텍스트 추출 */
function extractLinksFromHtml(html) {
  const categories = new Map();

  // 패턴: <a href="/np/categories/숫자..." ...>텍스트</a>
  const pattern = /<a\s[^>]*href="((?:https?:\/\/www\.coupang\.com)?\/np\/categories\/(\d+))[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = pattern.exec(html)) !== null) {
    const id = m[2];
    if (categories.has(id)) continue;

    let url = m[1];
    if (url.startsWith("/")) url = "https://www.coupang.com" + url;

    // <a>태그 내부 텍스트 (HTML 태그 제거)
    const name = m[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

    if (name && name.length >= 2 && name.length < 80) {
      categories.set(id, { id, name, url });
    }
  }

  // 이름 못 찾은 것들: title/alt 속성에서 시도
  const titlePattern = /href="(?:https?:\/\/www\.coupang\.com)?\/np\/categories\/(\d+)[^"]*"[^>]*(?:title|alt)="([^"]{2,60})"/gi;
  while ((m = titlePattern.exec(html)) !== null) {
    const id = m[1];
    if (categories.has(id)) continue;
    categories.set(id, {
      id,
      name: m[2],
      url: `https://www.coupang.com/np/categories/${id}`,
    });
  }

  return categories;
}

async function main() {
  const opts = parseArgs();

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
  console.log("쿠팡 전체 카테고리 수집 v3");
  console.log(`탐색 깊이: ${opts.depth}단계`);
  console.log("=".repeat(60));

  // 전체 결과
  const allCategories = new Map(); // id → { id, name, url, level, parentId, parentName }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 방법 A) <script> 태그 내 JSON 데이터 탐색
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("\n[방법 A] 페이지 내 JSON 데이터 탐색...");
  await page.goto("https://www.coupang.com", { waitUntil: "load", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));

  const scriptData = await page.evaluate(() => {
    const categories = [];
    // 모든 <script> 태그에서 카테고리 관련 JSON 탐색
    const scripts = document.querySelectorAll("script");
    for (const script of scripts) {
      const text = script.textContent || "";
      // "categories" 또는 "categoryId" 가 포함된 JSON 찾기
      if (text.includes("categor") && text.length > 100) {
        // JSON 객체 추출 시도
        const jsonMatches = text.match(/\{[^{}]*"categor[^{}]*\}/g);
        if (jsonMatches) {
          for (const jsonStr of jsonMatches.slice(0, 50)) {
            try {
              const obj = JSON.parse(jsonStr);
              if (obj.categoryId || obj.id) {
                categories.push(obj);
              }
            } catch {}
          }
        }

        // 배열 형태 탐색
        const arrMatches = text.match(/\[[^\[\]]*"categor[^\[\]]*\]/g);
        if (arrMatches) {
          for (const arrStr of arrMatches.slice(0, 20)) {
            try {
              const arr = JSON.parse(arrStr);
              if (Array.isArray(arr)) categories.push(...arr);
            } catch {}
          }
        }
      }
    }

    // window 객체에 카테고리 데이터가 있을 수 있음
    try {
      const keys = Object.keys(window);
      for (const key of keys) {
        const val = window[key];
        if (val && typeof val === "object" && JSON.stringify(val).includes("categor")) {
          categories.push({ _windowKey: key, data: val });
        }
      }
    } catch {}

    return categories;
  });

  if (scriptData.length > 0) {
    console.log(`  JSON 데이터 ${scriptData.length}개 발견`);
    writeFileSync(
      join(DATA_DIR, "categories-script-data.json"),
      JSON.stringify(scriptData, null, 2),
      "utf-8"
    );
  } else {
    console.log("  JSON 데이터 없음");
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 방법 B) 좌측 사이드바 hover → 서브 메뉴 열기
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("\n[방법 B] 사이드바 hover 탐색...");

  // 사이드바의 대분류 항목들 찾기
  const sidebarItems = await page.evaluate(() => {
    const items = [];
    // 다양한 셀렉터 시도
    const selectors = [
      "[class*='category'] li a",
      "[class*='Category'] li a",
      "[class*='sidebar'] li a",
      "[class*='lnb'] li a",
      "[class*='gnb'] li a",
      "[class*='nav'] li a[href*='categories']",
      "nav a[href*='categories']",
      "ul a[href*='/np/categories/']",
    ];

    const found = new Set();
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const href = el.getAttribute("href") || "";
        if (!href.includes("categories")) continue;
        const name = el.textContent?.trim();
        if (!name || found.has(name)) continue;
        found.add(name);

        const rect = el.getBoundingClientRect();
        items.push({
          name,
          href,
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          visible: rect.width > 0 && rect.height > 0,
        });
      }
    }
    return items;
  });

  console.log(`  사이드바 항목: ${sidebarItems.length}개 (보이는 것: ${sidebarItems.filter((i) => i.visible).length}개)`);

  // 보이는 사이드바 항목에 하나씩 hover
  const visibleItems = sidebarItems.filter((i) => i.visible);
  for (let i = 0; i < visibleItems.length; i++) {
    const item = visibleItems[i];
    console.log(`  hover [${i + 1}/${visibleItems.length}]: ${item.name}`);

    try {
      // 마우스를 항목 위로 이동
      await page.mouse.move(item.x, item.y, { steps: 5 });
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 500));

      // hover 후 나타난 서브 메뉴에서 카테고리 추출
      const html = await page.content();
      const links = extractLinksFromHtml(html);

      let newCount = 0;
      for (const [id, cat] of links) {
        if (!allCategories.has(id)) {
          allCategories.set(id, { ...cat, level: 0, parentId: null, parentName: null });
          newCount++;
        }
      }

      if (newCount > 0) {
        console.log(`    → ${newCount}개 새 카테고리 (총 ${allCategories.size}개)`);
      }
    } catch {}
  }

  // hover 안 된 경우를 대비해 현재 HTML에서도 추출
  const mainHtml = await page.content();
  const mainLinks = extractLinksFromHtml(mainHtml);
  for (const [id, cat] of mainLinks) {
    if (!allCategories.has(id)) {
      allCategories.set(id, { ...cat, level: 0, parentId: null, parentName: null });
    }
  }

  console.log(`\n  방법 A+B 합계: ${allCategories.size}개 카테고리`);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 방법 C) 각 카테고리 페이지 접속하여 하위 탐색
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // 레벨 0인 것들(메인에서 발견)을 레벨 1로 설정
  // 대분류 판별: 짧은 이름 + 다른 카테고리의 이름에 포함되지 않는 것
  const level0 = [...allCategories.values()];
  const allNames = level0.map((c) => c.name);

  for (const cat of level0) {
    // 이름이 짧고(<=10자) 다른 이름의 prefix가 아닌 것 = 대분류
    const isTop = cat.name.length <= 10 || allNames.filter((n) => n !== cat.name && n.includes(cat.name)).length > 0;
    cat.level = isTop ? 1 : 2;
  }

  // depth 2 이상이면 대분류 페이지 접속
  if (opts.depth >= 2) {
    const topCats = [...allCategories.values()].filter((c) => c.level === 1);
    console.log(`\n[방법 C] 대분류 ${topCats.length}개 페이지에서 하위 카테고리 수집`);

    for (let i = 0; i < topCats.length; i++) {
      const parent = topCats[i];
      console.log(`\n  [${i + 1}/${topCats.length}] ${parent.name}`);

      try {
        await page.goto(parent.url, { waitUntil: "load", timeout: 20000 });
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));

        // 스크롤
        for (let j = 0; j < 5; j++) {
          await page.evaluate(() => window.scrollBy(0, 500));
          await new Promise((r) => setTimeout(r, 300));
        }
        await page.evaluate(() => window.scrollTo(0, 0));

        const html = await page.content();
        const links = extractLinksFromHtml(html);

        let newCount = 0;
        for (const [id, cat] of links) {
          if (id === parent.id) continue;
          if (!allCategories.has(id)) {
            allCategories.set(id, {
              ...cat,
              level: 2,
              parentId: parent.id,
              parentName: parent.name,
            });
            newCount++;
          }
        }

        console.log(`    → ${newCount}개 하위 카테고리 (총 ${allCategories.size}개)`);

        if (i < topCats.length - 1) {
          const wait = 3 + Math.floor(Math.random() * 5);
          await new Promise((r) => setTimeout(r, wait * 1000));
        }
      } catch (err) {
        console.error(`    실패: ${err.message}`);
      }
    }
  }

  // depth 3: 중분류 → 소분류
  if (opts.depth >= 3) {
    const midCats = [...allCategories.values()].filter((c) => c.level === 2);
    console.log(`\n[소분류] 중분류 ${midCats.length}개 페이지에서 소분류 수집`);

    for (let i = 0; i < midCats.length; i++) {
      const parent = midCats[i];
      process.stdout.write(`  [${i + 1}/${midCats.length}] ${parent.name}...`);

      try {
        await page.goto(parent.url, { waitUntil: "load", timeout: 15000 });
        await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));

        const html = await page.content();
        const links = extractLinksFromHtml(html);

        let newCount = 0;
        for (const [id, cat] of links) {
          if (id === parent.id) continue;
          if (!allCategories.has(id)) {
            allCategories.set(id, {
              ...cat,
              level: 3,
              parentId: parent.id,
              parentName: parent.name,
            });
            newCount++;
          }
        }

        console.log(` ${newCount}개`);

        if (i < midCats.length - 1) {
          const wait = 2 + Math.floor(Math.random() * 3);
          await new Promise((r) => setTimeout(r, wait * 1000));
        }
      } catch {
        console.log(" 실패");
      }
    }
  }

  // ── 결과 정리 ──
  const sorted = [...allCategories.values()].sort((a, b) => {
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

  console.log("\n[레벨별 카테고리 수]");
  for (const [level, count] of Object.entries(levelCounts).sort()) {
    console.log(`  레벨 ${level}: ${count}개`);
  }

  // 대분류만 먼저 출력
  console.log("\n[대분류 목록]");
  sorted
    .filter((c) => c.level === 1)
    .forEach((cat, i) => {
      console.log(`  ${i + 1}. ${cat.name}`);
      console.log(`     ${cat.url}`);
    });

  // 전체 트리 출력
  console.log("\n[전체 카테고리 트리]");
  sorted.forEach((cat) => {
    const indent = "  ".repeat(cat.level);
    const parent = cat.parentName ? ` (← ${cat.parentName})` : "";
    console.log(`${indent}[Lv${cat.level}] ${cat.name}${parent}`);
    console.log(`${indent}      ${cat.url}`);
  });

  // ── 파일 저장 ──
  const output = {
    crawledAt: new Date().toISOString(),
    depth: opts.depth,
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
