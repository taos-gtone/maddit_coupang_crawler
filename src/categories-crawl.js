/**
 * 쿠팡 전체 카테고리 트리 수집 v7
 *
 * 동작:
 *   1) 쿠팡 메인 → 햄버거 "카테고리"에 마우스오버 → 대분류 열림
 *   2) 대분류에 마우스오버 → 2열(중분류) 나타남 → 수집
 *   3) 중분류에 마우스오버 → 3열(소분류) 나타남 → 3열 전체 수집
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

const TOP_NAMES = [
  "패션의류/잡화", "뷰티", "출산/유아동", "식품", "주방용품",
  "생활용품", "홈인테리어", "가전디지털", "스포츠/레저", "자동차용품",
  "도서/음반/DVD", "완구/취미", "문구/오피스", "반려동물용품",
  "헬스/건강식품", "여행/티켓", "테마관",
];

// 카테고리가 아닌 것들 (상단 탭, 기획전 등)
const EXCLUDE_NAMES = [
  "로켓프레시", "로켓배송", "로켓와우", "쿠팡플레이", "쿠팡이츠",
  "입점/판매 신청", "입점/판매신청",
];

/** 현재 보이는 카테고리 링크 전부 수집 */
async function getVisibleCategoryLinks(page) {
  return page.evaluate(() => {
    const items = [];
    const links = document.querySelectorAll("a[href*='/np/categories/']");

    for (const link of links) {
      const rect = link.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const name = link.textContent?.replace(/\s+/g, " ").trim();
      const href = link.getAttribute("href") || "";
      if (!name || name.length < 2) continue;

      const idMatch = href.match(/categories\/(\d+)/);
      let url = href;
      if (url.startsWith("/")) url = "https://www.coupang.com" + url;

      items.push({
        name,
        url,
        id: idMatch ? idMatch[1] : "",
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        cx: Math.round(rect.x + rect.width / 2),
        cy: Math.round(rect.y + rect.height / 2),
      });
    }
    return items;
  });
}

/** 링크 목록에서 특정 x범위의 열만 필터 */
function filterByColumn(links, minX, maxX) {
  return links.filter((l) => l.x >= minX && l.x <= maxX);
}

/** 링크 목록에서 3열(가장 오른쪽 열) 추출 */
function getThirdColumn(links, col2MaxX) {
  const col3Links = links.filter((l) => l.x > col2MaxX);
  if (col3Links.length === 0) return [];

  // 3열의 x좌표 범위 파악
  const col3MinX = Math.min(...col3Links.map((l) => l.x));
  // 같은 열에 있는 것만
  return col3Links.filter((l) => l.x >= col3MinX && l.x <= col3MinX + 120);
}

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
  console.log("쿠팡 전체 카테고리 수집 v7");
  console.log("=".repeat(60));

  // ── 1) 쿠팡 메인 접속 ──
  console.log("\n쿠팡 메인 접속...");
  await page.goto("https://www.coupang.com", { waitUntil: "load", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));

  // ── 2) 햄버거 "카테고리"에 마우스오버 → 대분류 열림 ──
  console.log("카테고리 메뉴에 마우스오버...");

  const menuPos = await page.evaluate(() => {
    const allEls = document.querySelectorAll("*");
    let bestMatch = null;
    let bestArea = Infinity;

    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const text = el.textContent?.trim();
      if (!text) continue;
      if (text.includes("카테고리") && text.length < 15) {
        const area = rect.width * rect.height;
        if (area < bestArea) {
          bestArea = area;
          bestMatch = {
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2),
          };
        }
      }
    }
    return bestMatch;
  });

  const hoverX = menuPos?.x || 45;
  const hoverY = menuPos?.y || 55;
  console.log(`  hover 위치: (${hoverX}, ${hoverY})`);
  await page.mouse.move(hoverX, hoverY, { steps: 5 });
  await new Promise((r) => setTimeout(r, 2000));

  // 메뉴 열림 확인
  let allLinks = await getVisibleCategoryLinks(page);
  const menuOpened = allLinks.some((l) => TOP_NAMES.some((n) => l.name === n || l.name.includes(n)));

  if (!menuOpened) {
    console.log("  ⚠️ 메뉴 안 열림 — 클릭 후 재시도...");
    await page.mouse.click(hoverX, hoverY);
    await new Promise((r) => setTimeout(r, 1000));
    await page.mouse.move(hoverX, hoverY, { steps: 3 });
    await new Promise((r) => setTimeout(r, 2000));
    allLinks = await getVisibleCategoryLinks(page);
  }

  // ── 3) 대분류(1열) 찾기 ──
  console.log("\n[1단계] 대분류 확인...");

  const level1Items = [];
  for (const topName of TOP_NAMES) {
    const found = allLinks.find((l) => l.name === topName || l.name.includes(topName) || topName.includes(l.name));
    if (found) level1Items.push(found);
  }

  console.log(`  대분류: ${level1Items.length}/${TOP_NAMES.length}개`);

  if (level1Items.length === 0) {
    console.log("\n  ❌ 대분류를 찾을 수 없습니다.");
    console.log("  현재 보이는 링크:");
    allLinks.slice(0, 20).forEach((l) => console.log(`    "${l.name}" x:${l.x} y:${l.y}`));
    await page.close();
    browser.close();
    process.exit(1);
  }

  // 1열 x좌표 범위
  const col1Xs = level1Items.map((i) => i.x);
  const col1MaxX = Math.max(...col1Xs) + 80;
  const topIdSet = new Set(level1Items.map((i) => i.id));

  // 결과 저장
  const allCategories = [];
  for (const item of level1Items) {
    allCategories.push({ level: 1, ...item, parentId: null, parentName: null });
  }

  // ── 4) 대분류 hover → 중분류 + 소분류 수집 ──
  console.log("\n[2단계] 대분류별 중분류 + 소분류 수집");

  for (let i = 0; i < level1Items.length; i++) {
    const parent = level1Items[i];
    console.log(`\n  [${i + 1}/${level1Items.length}] "${parent.name}" hover...`);

    // 대분류 hover
    await page.mouse.move(parent.cx, parent.cy, { steps: 5 });
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 400));

    const afterHover = await getVisibleCategoryLinks(page);

    // 2열(중분류) 추출 = 1열보다 오른쪽, 대분류 아닌 것, 제외 목록 아닌 것
    const rightOfCol1 = afterHover.filter((l) => {
      if (l.x <= col1MaxX) return false;
      if (topIdSet.has(l.id)) return false;
      if (EXCLUDE_NAMES.some((ex) => l.name.includes(ex))) return false;
      if (TOP_NAMES.some((tn) => l.name === tn)) return false;
      return true;
    });

    // 2열의 x범위 파악
    let col2Items = [];
    let col2MaxX = 0;
    if (rightOfCol1.length > 0) {
      const col2MinX = Math.min(...rightOfCol1.map((l) => l.x));
      col2Items = rightOfCol1.filter((l) => l.x >= col2MinX && l.x <= col2MinX + 100);
      col2MaxX = col2MinX + 100;
    }

    // 중분류 저장 (중복 제거) — 모든 col2Items는 hover 대상으로 유지
    const seenIds = new Set(allCategories.map((c) => c.id));
    for (const mid of col2Items) {
      if (!mid.id || seenIds.has(mid.id)) continue;
      seenIds.add(mid.id);
      allCategories.push({
        level: 2, ...mid, parentId: parent.id, parentName: parent.name,
      });
    }

    console.log(`    중분류 ${col2Items.length}개: ${col2Items.map((m) => m.name).join(", ")}`);

    // ── 5) 각 중분류 hover → 소분류(3열) 전체 수집 ──
    // 먼저 대분류에 다시 hover해서 2열을 안정적으로 유지
    for (const mid of col2Items) {
      // 대분류 → 중분류 순서로 hover (메뉴가 닫히지 않도록)
      await page.mouse.move(parent.cx, parent.cy, { steps: 3 });
      await new Promise((r) => setTimeout(r, 300));

      // 중분류에 hover
      await page.mouse.move(mid.cx, mid.cy, { steps: 3 });
      await new Promise((r) => setTimeout(r, 500 + Math.random() * 300));

      // hover 후 3열(소분류) 전체 수집
      const afterMidHover = await getVisibleCategoryLinks(page);
      const col3All = getThirdColumn(afterMidHover, col2MaxX);

      // 대분류/중분류 id 제외, 이미 수집된 것 제외, 제외 목록 필터
      const newSmalls = col3All.filter((s) => {
        if (!s.id || topIdSet.has(s.id) || seenIds.has(s.id)) return false;
        if (EXCLUDE_NAMES.some((ex) => s.name.includes(ex))) return false;
        if (TOP_NAMES.some((tn) => s.name === tn)) return false;
        return true;
      });

      for (const small of newSmalls) {
        seenIds.add(small.id);
        allCategories.push({
          level: 3, ...small, parentId: mid.id, parentName: mid.name,
        });
      }

      if (newSmalls.length > 0) {
        console.log(`      ${mid.name} → 소분류 ${newSmalls.length}개: ${newSmalls.map((s) => s.name).join(", ")}`);
      }
    }

    // 다음 대분류 전에 살짝 대기
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
  }

  // ── 결과 출력 ──
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

  // 트리 출력: 카테고리명 옆에 바로 URL
  console.log("\n[카테고리 트리]");
  const level1 = allCategories.filter((c) => c.level === 1);

  for (const top of level1) {
    console.log(`${top.name}\t${top.url}`);

    const mids = allCategories.filter((c) => c.level === 2 && c.parentId === top.id);
    for (const mid of mids) {
      console.log(`\t${mid.name}\t${mid.url}`);

      const smalls = allCategories.filter((c) => c.level === 3 && c.parentId === mid.id);
      for (const small of smalls) {
        console.log(`\t\t${small.name}\t${small.url}`);
      }
    }
  }

  // ── 파일 저장 ──
  const output = {
    crawledAt: new Date().toISOString(),
    totalCategories: allCategories.length,
    levelCounts,
    categories: allCategories,
  };

  const jsonPath = join(DATA_DIR, "categories.json");
  writeFileSync(jsonPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`\n저장: ${jsonPath}`);

  const csvLines = ["level,id,name,url,parentId,parentName"];
  for (const cat of allCategories) {
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
