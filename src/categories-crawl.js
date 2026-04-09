/**
 * 쿠팡 전체 카테고리 트리 수집 v2
 *
 * 전략: 메뉴 클릭 없이 HTML 원본에서 직접 추출
 *   1) 메인 페이지 HTML에서 /np/categories/ 링크 전부 수집
 *   2) 각 대분류 페이지 접속 → 사이드바/본문의 하위 카테고리 수집
 *   3) 하위 카테고리 페이지 접속 → 더 깊은 레벨 수집
 *
 * 사용법:
 *   node src/categories-crawl.js
 *   node src/categories-crawl.js --depth 3   (탐색 깊이, 기본 2)
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

/** 페이지 HTML에서 모든 카테고리 링크 추출 (메뉴 클릭 불필요) */
async function extractCategoryLinks(page) {
  // DOM이 아니라 HTML 원본에서 regex로 추출 — 숨겨진 메뉴 안의 링크도 잡힘
  const html = await page.content();

  const categories = new Map();

  // 패턴 1: href="/np/categories/숫자" 또는 href="https://www.coupang.com/np/categories/숫자"
  const linkPattern = /href="((?:https?:\/\/www\.coupang\.com)?\/np\/categories\/(\d+))[^"]*"/g;
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    const id = match[2];
    if (categories.has(id)) continue;

    let url = match[1];
    if (url.startsWith("/")) url = "https://www.coupang.com" + url;

    // 이 링크 주변에서 텍스트(카테고리명) 추출
    const pos = match.index;

    // 방법 1: 같은 <a> 태그 안의 텍스트
    const afterLink = html.slice(pos, Math.min(html.length, pos + 500));
    const tagContent = afterLink.match(/>([\s\S]*?)<\/a>/);
    let name = "";
    if (tagContent) {
      // HTML 태그 제거하고 텍스트만
      name = tagContent[1].replace(/<[^>]+>/g, "").trim();
    }

    // 방법 2: title 속성
    if (!name || name.length < 2) {
      const titleMatch = afterLink.match(/title="([^"]+)"/);
      if (titleMatch) name = titleMatch[1];
    }

    // 방법 3: 바로 앞 텍스트
    if (!name || name.length < 2) {
      const beforeLink = html.slice(Math.max(0, pos - 200), pos);
      const textMatch = beforeLink.match(/>([^<]{2,30})$/);
      if (textMatch) name = textMatch[1].trim();
    }

    if (name && name.length >= 2 && name.length < 80) {
      categories.set(id, { id, name, url });
    }
  }

  return [...categories.values()];
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
  console.log("쿠팡 전체 카테고리 수집 v2");
  console.log(`탐색 깊이: ${opts.depth}단계`);
  console.log("=".repeat(60));

  // ── 1단계: 메인 페이지에서 대분류 카테고리 수집 ──
  console.log("\n[1단계] 메인 페이지 카테고리 수집...");
  await page.goto("https://www.coupang.com", { waitUntil: "load", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));

  // 스크롤해서 lazy 메뉴도 로드
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 500));
    await new Promise((r) => setTimeout(r, 300));
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 1000));

  // 마우스를 카테고리 영역 위로 이동 (hover 메뉴 트리거)
  try {
    // 페이지 왼쪽 상단 영역을 천천히 훑기
    for (let y = 50; y < 400; y += 30) {
      await page.mouse.move(100, y);
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 2000));
  } catch {}

  const level1 = await extractCategoryLinks(page);
  console.log(`  메인에서 ${level1.length}개 카테고리 발견`);

  // 전체 결과 저장용
  const allCategories = new Map(); // id → { id, name, url, level, parentId, parentName }

  for (const cat of level1) {
    allCategories.set(cat.id, { ...cat, level: 1, parentId: null, parentName: null });
  }

  // ── 2단계: 각 대분류 페이지에서 하위 카테고리 수집 ──
  if (opts.depth >= 2) {
    // level 1 중에서 대분류만 필터 (하위 카테고리가 아닌 것들)
    const topLevel = level1.filter((c) => {
      // 짧은 이름이 대분류일 가능성 높음
      return c.name.length <= 15;
    });

    console.log(`\n[2단계] 대분류 ${topLevel.length}개 → 하위 카테고리 수집`);

    for (let i = 0; i < topLevel.length; i++) {
      const parent = topLevel[i];
      console.log(`\n  [${i + 1}/${topLevel.length}] ${parent.name}`);
      console.log(`    ${parent.url}`);

      try {
        await page.goto(parent.url, { waitUntil: "load", timeout: 20000 });
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));

        // 스크롤
        for (let j = 0; j < 5; j++) {
          await page.evaluate(() => window.scrollBy(0, 500));
          await new Promise((r) => setTimeout(r, 300));
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await new Promise((r) => setTimeout(r, 500));

        const subs = await extractCategoryLinks(page);

        // 부모 자신은 제외
        const newSubs = subs.filter((s) => s.id !== parent.id && !allCategories.has(s.id));

        for (const sub of newSubs) {
          allCategories.set(sub.id, {
            ...sub,
            level: 2,
            parentId: parent.id,
            parentName: parent.name,
          });
        }

        console.log(`    → ${newSubs.length}개 하위 카테고리 추가 (총 ${allCategories.size}개)`);

        // 다음 대분류 전 대기
        if (i < topLevel.length - 1) {
          const wait = 3 + Math.floor(Math.random() * 5);
          await new Promise((r) => setTimeout(r, wait * 1000));
        }
      } catch (err) {
        console.error(`    실패: ${err.message}`);
      }
    }
  }

  // ── 3단계: 중분류에서 소분류 수집 ──
  if (opts.depth >= 3) {
    const level2 = [...allCategories.values()].filter((c) => c.level === 2);
    console.log(`\n[3단계] 중분류 ${level2.length}개 → 소분류 수집`);

    for (let i = 0; i < level2.length; i++) {
      const parent = level2[i];
      console.log(`  [${i + 1}/${level2.length}] ${parent.parentName} > ${parent.name}`);

      try {
        await page.goto(parent.url, { waitUntil: "load", timeout: 20000 });
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));

        for (let j = 0; j < 3; j++) {
          await page.evaluate(() => window.scrollBy(0, 500));
          await new Promise((r) => setTimeout(r, 300));
        }

        const subs = await extractCategoryLinks(page);
        const newSubs = subs.filter((s) => s.id !== parent.id && !allCategories.has(s.id));

        for (const sub of newSubs) {
          allCategories.set(sub.id, {
            ...sub,
            level: 3,
            parentId: parent.id,
            parentName: parent.name,
          });
        }

        if (newSubs.length > 0) {
          console.log(`    → ${newSubs.length}개 소분류 추가`);
        }

        // 대기
        if (i < level2.length - 1) {
          const wait = 2 + Math.floor(Math.random() * 4);
          await new Promise((r) => setTimeout(r, wait * 1000));
        }
      } catch (err) {
        console.error(`    실패: ${err.message}`);
      }
    }
  }

  // ── 결과 정리 + 출력 ──
  const sorted = [...allCategories.values()].sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    return a.name.localeCompare(b.name, "ko");
  });

  // 레벨별 통계
  const levelCounts = {};
  for (const cat of sorted) {
    levelCounts[cat.level] = (levelCounts[cat.level] || 0) + 1;
  }

  console.log("\n" + "=".repeat(60));
  console.log(`총 ${sorted.length}개 카테고리 수집 완료`);
  console.log("=".repeat(60));

  console.log("\n[레벨별 카테고리 수]");
  for (const [level, count] of Object.entries(levelCounts)) {
    console.log(`  레벨 ${level}: ${count}개`);
  }

  console.log("\n[카테고리 트리]");
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
