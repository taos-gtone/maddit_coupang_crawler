/**
 * 쿠팡 전체 카테고리 트리 수집 v8
 *
 * 동작:
 *   1) 쿠팡 메인 → 햄버거 "카테고리"에 마우스오버 → 대분류 열림
 *   2) 대분류에 마우스오버 → 2열(중분류) 나타남
 *   3) 중분류에 마우스오버 → 3열(소분류) 나타남
 *   - L자 마우스 이동으로 다른 대분류 건드리지 않음
 *   - 2열 스크롤 처리로 숨겨진 중분류도 수집
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

const EXCLUDE_NAMES = [
  "로켓프레시", "로켓배송", "로켓와우", "쿠팡플레이", "쿠팡이츠",
  "입점/판매 신청", "입점/판매신청", "더보기",
];

/** 화면에 보이는 카테고리 링크 수집 */
async function getVisibleLinks(page) {
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
        name, url,
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

/** 필터: 제외 목록 + 대분류 이름/id */
function isValidSub(link, topIdSet) {
  if (!link.id) return false;
  if (topIdSet.has(link.id)) return false;
  if (EXCLUDE_NAMES.some((ex) => link.name.includes(ex))) return false;
  if (TOP_NAMES.some((tn) => link.name === tn)) return false;
  return true;
}

/** x좌표 그룹핑으로 2열(가장 항목 많은 열) 추출 */
function extractColumn(links) {
  if (links.length === 0) return { items: [], minX: 0, maxX: 0 };

  const xGroups = new Map();
  for (const l of links) {
    const bucket = Math.round(l.x / 15) * 15;
    if (!xGroups.has(bucket)) xGroups.set(bucket, []);
    xGroups.get(bucket).push(l);
  }

  let bestBucket = 0;
  let bestCount = 0;
  for (const [bucket, items] of xGroups) {
    if (items.length > bestCount) {
      bestCount = items.length;
      bestBucket = bucket;
    }
  }

  const minX = bestBucket - 30;
  const maxX = bestBucket + 80;
  return {
    items: links.filter((l) => l.x >= minX && l.x <= maxX),
    minX, maxX,
  };
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
  console.log("쿠팡 전체 카테고리 수집 v8");
  console.log("=".repeat(60));

  // ── 1) 쿠팡 메인 ──
  console.log("\n쿠팡 메인 접속...");
  await page.goto("https://www.coupang.com", { waitUntil: "load", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));

  // ── 2) 햄버거 hover → 대분류 열기 ──
  console.log("카테고리 메뉴에 마우스오버...");

  const menuPos = await page.evaluate(() => {
    const allEls = document.querySelectorAll("*");
    let best = null;
    let bestArea = Infinity;
    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const text = el.textContent?.trim();
      if (text?.includes("카테고리") && text.length < 15) {
        const area = rect.width * rect.height;
        if (area < bestArea) {
          bestArea = area;
          best = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
      }
    }
    return best;
  });

  const hx = menuPos?.x || 45, hy = menuPos?.y || 55;
  await page.mouse.move(hx, hy, { steps: 5 });
  await new Promise((r) => setTimeout(r, 2000));

  // ── 3) 대분류 찾기 ──
  console.log("\n[1단계] 대분류 확인...");
  let allLinks = await getVisibleLinks(page);

  const level1Items = [];
  for (const topName of TOP_NAMES) {
    const found = allLinks.find((l) => l.name === topName || l.name.includes(topName) || topName.includes(l.name));
    if (found) level1Items.push(found);
  }

  if (level1Items.length === 0) {
    // 재시도: 클릭 후 hover
    await page.mouse.click(hx, hy);
    await new Promise((r) => setTimeout(r, 1000));
    await page.mouse.move(hx, hy, { steps: 3 });
    await new Promise((r) => setTimeout(r, 2000));
    allLinks = await getVisibleLinks(page);
    for (const topName of TOP_NAMES) {
      const found = allLinks.find((l) => l.name === topName || l.name.includes(topName) || topName.includes(l.name));
      if (found && !level1Items.find((i) => i.id === found.id)) level1Items.push(found);
    }
  }

  console.log(`  대분류: ${level1Items.length}개`);
  level1Items.forEach((item, i) => console.log(`  ${i + 1}. ${item.name}\t${item.url}`));

  if (level1Items.length === 0) {
    console.log("  ❌ 대분류를 찾을 수 없습니다.");
    await page.close();
    browser.close();
    process.exit(1);
  }

  const col1MaxX = Math.max(...level1Items.map((i) => i.x)) + 80;
  const topIdSet = new Set(level1Items.map((i) => i.id));
  const allCategories = [];
  const globalSeenIds = new Set();

  // 대분류 저장
  for (const item of level1Items) {
    globalSeenIds.add(item.id);
    allCategories.push({ level: 1, ...item, parentId: null, parentName: null });
  }

  // ── 4) 대분류별 중분류 + 소분류 수집 ──
  console.log("\n[2단계] 대분류별 중분류 + 소분류 수집");

  for (let i = 0; i < level1Items.length; i++) {
    const parent = level1Items[i];
    console.log(`\n  [${i + 1}/${level1Items.length}] "${parent.name}" hover...`);

    // 대분류 hover
    await page.mouse.move(parent.cx, parent.cy, { steps: 5 });
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 400));

    // 보이는 링크 수집
    const afterHover = await getVisibleLinks(page);
    const rightLinks = afterHover.filter((l) => l.x > col1MaxX && isValidSub(l, topIdSet));
    const col2 = extractColumn(rightLinks);

    // 2열에서 보이는 항목의 부모 컨테이너를 찾고,
    // 그 안의 모든 카테고리 링크를 수집 (화면 밖 잘린 것 포함)
    if (col2.items.length > 0) {
      const extraItems = await page.evaluate(({ sampleId }) => {
        // 이미 찾은 2열 항목 중 하나의 <a> 태그를 기준으로 부모 컨테이너 찾기
        const sampleLink = document.querySelector(`a[href*='/np/categories/${sampleId}']`);
        if (!sampleLink) return [];

        // 부모를 올라가면서 카테고리 링크를 여러 개 담고 있는 컨테이너 찾기
        let container = sampleLink.parentElement;
        while (container) {
          const links = container.querySelectorAll("a[href*='/np/categories/']");
          // 컨테이너가 2개 이상 카테고리 링크를 가지고 있고,
          // 너무 크지 않은 것 (body 전체가 아닌)
          if (links.length >= 2 && links.length <= 30 && container.tagName !== "BODY") {
            break;
          }
          container = container.parentElement;
        }

        if (!container) return [];

        // 이 컨테이너 안의 모든 카테고리 링크 수집
        const found = [];
        const links = container.querySelectorAll("a[href*='/np/categories/']");
        for (const a of links) {
          const href = a.getAttribute("href") || "";
          const idMatch = href.match(/categories\/(\d+)/);
          if (!idMatch) continue;
          const name = a.textContent?.replace(/\s+/g, " ").trim();
          if (!name || name.length < 2) continue;
          let url = href;
          if (url.startsWith("/")) url = "https://www.coupang.com" + url;
          const rect = a.getBoundingClientRect();
          found.push({
            name, url, id: idMatch[1],
            x: Math.round(rect.x), y: Math.round(rect.y),
            cx: Math.round(rect.x + rect.width / 2),
            cy: Math.round(rect.y + rect.height / 2),
          });
        }
        return found;
      }, { sampleId: col2.items[0].id });

      // 추가 발견된 항목 합치기
      if (extraItems.length > 0) {
        const existingIds = new Set(col2.items.map((i) => i.id));
        for (const item of extraItems) {
          if (!existingIds.has(item.id) && isValidSub(item, topIdSet)) {
            existingIds.add(item.id);
            col2.items.push(item);
          }
        }
      }
    }

    // 중분류 저장
    const midItems = col2.items.filter((m) => !globalSeenIds.has(m.id));
    for (const mid of midItems) {
      globalSeenIds.add(mid.id);
      allCategories.push({ level: 2, ...mid, parentId: parent.id, parentName: parent.name });
    }

    console.log(`    중분류 ${midItems.length}개: ${midItems.map((m) => m.name).join(", ")}`);

    // 각 중분류 hover → 소분류 수집
    for (const mid of col2.items) {
      // L자 이동: 대분류 y → 오른쪽 → 중분류 y
      await page.mouse.move(parent.cx, parent.cy, { steps: 3 });
      await new Promise((r) => setTimeout(r, 300));
      await page.mouse.move(mid.cx, parent.cy, { steps: 2 });
      await new Promise((r) => setTimeout(r, 100));
      await page.mouse.move(mid.cx, mid.cy, { steps: 3 });
      await new Promise((r) => setTimeout(r, 500 + Math.random() * 300));

      // 3열(소분류) 수집
      const afterMidHover = await getVisibleLinks(page);
      const col3Links = afterMidHover.filter((l) => l.x > col2.maxX && isValidSub(l, topIdSet) && !globalSeenIds.has(l.id));

      // 3열만 추출 (x 그룹핑)
      const col3 = extractColumn(col3Links);
      const newSmalls = col3.items.filter((s) => !globalSeenIds.has(s.id));

      for (const small of newSmalls) {
        globalSeenIds.add(small.id);
        allCategories.push({ level: 3, ...small, parentId: mid.id, parentName: mid.name });
      }

      if (newSmalls.length > 0) {
        console.log(`      ${mid.name} → 소분류 ${newSmalls.length}개: ${newSmalls.map((s) => s.name).join(", ")}`);
      }
    }

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

  // 트리 출력
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
    csvLines.push(`${cat.level},${cat.id},"${safeName}",${cat.url},${cat.parentId || ""},"${safeParent}"`);
  }
  const csvPath = join(DATA_DIR, "categories.csv");
  writeFileSync(csvPath, "\uFEFF" + csvLines.join("\n"), "utf-8");
  console.log(`저장: ${csvPath}`);

  await page.close();
  browser.close();
  console.log("\n완료!");
}

main().catch(console.error);
