/**
 * 쿠팡 전체 카테고리 트리 수집 v5
 *
 * 전략:
 *   - 대분류: 확정 목록 (스크린샷 기반, 쿠팡 메뉴 고정 구조)
 *   - 중분류: 각 대분류 페이지 접속 → HTML에서 추출
 *   - 소분류: 각 중분류 페이지 접속 → HTML에서 추출 (--depth 3)
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

// ── 대분류 (쿠팡 카테고리 메뉴 고정 목록) ──
const TOP_CATEGORIES = [
  { name: "패션의류/잡화",   id: "186764", url: "https://www.coupang.com/np/categories/186764" },
  { name: "뷰티",           id: "453050", url: "https://www.coupang.com/np/categories/453050" },
  { name: "출산/유아동",     id: "171566", url: "https://www.coupang.com/np/categories/171566" },
  { name: "식품",           id: "194276", url: "https://www.coupang.com/np/categories/194276" },
  { name: "주방용품",       id: "184555", url: "https://www.coupang.com/np/categories/184555" },
  { name: "생활용품",       id: "115573", url: "https://www.coupang.com/np/categories/115573" },
  { name: "홈인테리어",     id: "115574", url: "https://www.coupang.com/np/categories/115574" },
  { name: "가전디지털",     id: "185669", url: "https://www.coupang.com/np/categories/185669" },
  { name: "스포츠/레저",    id: "317678", url: "https://www.coupang.com/np/categories/317678" },
  { name: "자동차용품",     id: "305798", url: "https://www.coupang.com/np/categories/305798" },
  { name: "도서/음반/DVD",  id: "102104", url: "https://www.coupang.com/np/categories/102104" },
  { name: "완구/취미",      id: "497135", url: "https://www.coupang.com/np/categories/497135" },
  { name: "문구/오피스",    id: "230702", url: "https://www.coupang.com/np/categories/230702" },
  { name: "반려동물용품",   id: "453049", url: "https://www.coupang.com/np/categories/453049" },
  { name: "헬스/건강식품",  id: "305798", url: "https://www.coupang.com/np/categories/305798" },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { depth: 2 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--depth" && args[i + 1]) opts.depth = parseInt(args[++i], 10);
  }
  return opts;
}

/** 페이지 HTML에서 카테고리 링크 추출 (현재 페이지의 하위 카테고리) */
function extractSubCategories(html, parentId) {
  const categories = new Map();

  // <a href="/np/categories/숫자">텍스트</a> 패턴
  const pattern = /<a\s[^>]*href="((?:https?:\/\/www\.coupang\.com)?\/np\/categories\/(\d+))[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = pattern.exec(html)) !== null) {
    const id = m[2];
    if (id === parentId) continue; // 자기 자신 제외
    if (categories.has(id)) continue;

    let url = m[1];
    if (url.startsWith("/")) url = "https://www.coupang.com" + url;

    const name = m[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (name && name.length >= 2 && name.length < 80) {
      categories.set(id, { id, name, url });
    }
  }

  // title 속성에서도 시도
  const titlePattern = /<a\s[^>]*href="(?:https?:\/\/www\.coupang\.com)?\/np\/categories\/(\d+)[^"]*"[^>]*title="([^"]{2,60})"[^>]*>/gi;
  while ((m = titlePattern.exec(html)) !== null) {
    const id = m[1];
    if (id === parentId || categories.has(id)) continue;
    categories.set(id, {
      id,
      name: m[2],
      url: `https://www.coupang.com/np/categories/${id}`,
    });
  }

  return [...categories.values()];
}

/** 페이지 접속 후 사이드바/네비 영역에서만 하위 카테고리 추출 */
async function crawlSubCategories(page, parentUrl, parentId) {
  try {
    await page.goto(parentUrl, { waitUntil: "load", timeout: 20000 });
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));

    // 스크롤
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 500));
      await new Promise((r) => setTimeout(r, 300));
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 500));

    // DOM에서 사이드바/네비 영역만 먼저 시도
    const domSubs = await page.evaluate((pId) => {
      const results = [];
      // 사이드바/필터/네비게이션 영역 셀렉터
      const containers = document.querySelectorAll(
        "[class*='side'] , [class*='Side'], [class*='lnb'], [class*='Lnb'], " +
        "[class*='filter'], [class*='Filter'], [class*='nav-category'], " +
        "[class*='category-list'], [class*='CategoryList'], [class*='sub-category'], " +
        "[class*='breadcrumb'], [class*='Breadcrumb']"
      );

      const links = new Set();
      for (const container of containers) {
        container.querySelectorAll("a[href*='/np/categories/']").forEach((a) => links.add(a));
      }

      // 사이드바가 못 찾으면 전체에서 찾되, 다른 대분류 ID는 제외
      if (links.size === 0) {
        document.querySelectorAll("a[href*='/np/categories/']").forEach((a) => links.add(a));
      }

      for (const link of links) {
        const href = link.getAttribute("href") || "";
        const idMatch = href.match(/categories\/(\d+)/);
        if (!idMatch || idMatch[1] === pId) continue;

        const name = link.textContent?.replace(/\s+/g, " ").trim();
        if (!name || name.length < 2 || name.length > 40) continue;

        let url = href;
        if (url.startsWith("/")) url = "https://www.coupang.com" + url;

        results.push({ id: idMatch[1], name, url });
      }

      // 중복 제거
      const seen = new Set();
      return results.filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
    }, parentId);

    if (domSubs.length > 0) return domSubs;

    // DOM 실패 시 HTML regex fallback
    const html = await page.content();
    return extractSubCategories(html, parentId);
  } catch (err) {
    console.error(`    접속 실패: ${err.message}`);
    return [];
  }
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
  console.log("쿠팡 전체 카테고리 수집 v5");
  console.log(`탐색 깊이: ${opts.depth}단계`);
  console.log("=".repeat(60));

  const allCategories = [];

  // ── 1단계: 대분류 (고정 목록) ──
  console.log("\n[1단계] 대분류 (고정 목록)");
  for (const cat of TOP_CATEGORIES) {
    allCategories.push({
      level: 1,
      id: cat.id,
      name: cat.name,
      url: cat.url,
      parentId: null,
      parentName: null,
    });
    console.log(`  ${cat.name} — ${cat.url}`);
  }

  // ── 2단계: 대분류 → 중분류 ──
  console.log(`\n[2단계] 대분류 ${TOP_CATEGORIES.length}개 → 중분류 수집`);

  // 먼저 대분류 ID 검증 + 실제 중분류 수집
  for (let i = 0; i < TOP_CATEGORIES.length; i++) {
    const parent = TOP_CATEGORIES[i];
    console.log(`\n  [${i + 1}/${TOP_CATEGORIES.length}] ${parent.name}`);

    const subs = await crawlSubCategories(page, parent.url, parent.id);

    // 다른 대분류 이름/ID 필터 + 의미 없는 링크 제외
    const topIds = new Set(TOP_CATEGORIES.map((t) => t.id));
    const topNames = new Set(TOP_CATEGORIES.map((t) => t.name));
    const validSubs = subs.filter((s) => {
      if (!s.id || s.name.length > 30) return false;
      if (topIds.has(s.id)) return false;          // 다른 대분류 id
      if (topNames.has(s.name)) return false;       // 다른 대분류 이름
      return true;
    });

    for (const sub of validSubs) {
      // 이미 수집된 것 건너뛰기
      if (allCategories.find((c) => c.id === sub.id)) continue;

      allCategories.push({
        level: 2,
        id: sub.id,
        name: sub.name,
        url: sub.url,
        parentId: parent.id,
        parentName: parent.name,
      });
    }

    console.log(`    → 중분류 ${validSubs.length}개: ${validSubs.map((s) => s.name).join(", ")}`);

    // 다음 대분류 전 대기
    if (i < TOP_CATEGORIES.length - 1) {
      const wait = 3 + Math.floor(Math.random() * 5);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }

  // ── 3단계: 중분류 → 소분류 (--depth 3) ──
  if (opts.depth >= 3) {
    const midCats = allCategories.filter((c) => c.level === 2);
    console.log(`\n[3단계] 중분류 ${midCats.length}개 → 소분류 수집`);

    for (let i = 0; i < midCats.length; i++) {
      const parent = midCats[i];
      process.stdout.write(`  [${i + 1}/${midCats.length}] ${parent.parentName} > ${parent.name}...`);

      const subs = await crawlSubCategories(page, parent.url, parent.id);
      const validSubs = subs.filter((s) => s.id && s.name.length <= 30);

      let newCount = 0;
      for (const sub of validSubs) {
        if (allCategories.find((c) => c.id === sub.id)) continue;

        allCategories.push({
          level: 3,
          id: sub.id,
          name: sub.name,
          url: sub.url,
          parentId: parent.id,
          parentName: parent.name,
        });
        newCount++;
      }

      console.log(` ${newCount}개`);

      if (i < midCats.length - 1) {
        const wait = 2 + Math.floor(Math.random() * 3);
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
    }
  }

  // ── 결과 정리 ──
  const sorted = allCategories.sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    // 같은 레벨이면 부모별로 그룹핑
    if (a.parentName !== b.parentName) {
      return (a.parentName || "").localeCompare(b.parentName || "", "ko");
    }
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

  // 트리 형태 출력 (들여쓰기로 계층 표현)
  console.log("\n[카테고리 트리]");
  const level1 = sorted.filter((c) => c.level === 1);

  for (const top of level1) {
    console.log(`${top.name}`);
    console.log(`  ${top.url}`);

    const mids = sorted.filter((c) => c.level === 2 && c.parentId === top.id);
    for (const mid of mids) {
      console.log(`\t${mid.name}`);
      console.log(`\t  ${mid.url}`);

      if (opts.depth >= 3) {
        const smalls = sorted.filter((c) => c.level === 3 && c.parentId === mid.id);
        for (const small of smalls) {
          console.log(`\t\t${small.name}`);
          console.log(`\t\t  ${small.url}`);
        }
      }
    }
  }

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
