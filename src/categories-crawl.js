/**
 * 쿠팡 전체 카테고리 트리 수집 v6
 *
 * 정확한 동작:
 *   1) 쿠팡 메인 → 좌상단 햄버거 클릭 → 카테고리 메뉴 열림
 *   2) 1열(대분류)에 마우스오버 → 2열(중분류) 나타남
 *   3) 2열(중분류)에 마우스오버 → 3열(소분류) 나타남
 *   4) 대분류 이름 기준으로 매칭하여 hover
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

// 대분류 이름 목록 (메뉴 순서대로)
const TOP_NAMES = [
  "패션의류/잡화",
  "뷰티",
  "출산/유아동",
  "식품",
  "주방용품",
  "생활용품",
  "홈인테리어",
  "가전디지털",
  "스포츠/레저",
  "자동차용품",
  "도서/음반/DVD",
  "완구/취미",
  "문구/오피스",
  "반려동물용품",
  "헬스/건강식품",
  "여행/티켓",
  "테마관",
];

/** 현재 보이는 카테고리 링크를 x좌표 범위별로 추출 */
async function getVisibleCategoryLinks(page) {
  return page.evaluate(() => {
    const items = [];
    const links = document.querySelectorAll("a[href*='/np/categories/']");

    for (const link of links) {
      const rect = link.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // 화면 밖 제외
      if (rect.y < 0 || rect.y > window.innerHeight) continue;

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
  console.log("쿠팡 전체 카테고리 수집 v6 (메뉴 hover 방식)");
  console.log("=".repeat(60));

  // ── 1) 쿠팡 메인 접속 ──
  console.log("\n쿠팡 메인 접속...");
  await page.goto("https://www.coupang.com", { waitUntil: "load", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));

  // ── 2) 카테고리 메뉴 열기 ──
  // 파란 배경 햄버거(≡) + "카테고리" 버튼 클릭
  console.log("카테고리 메뉴 열기...");

  const clicked = await page.evaluate(() => {
    // 전략 1: "카테고리" 텍스트를 포함하는 요소 중 가장 작은(정확한) 것
    const allEls = document.querySelectorAll("*");
    let bestMatch = null;
    let bestArea = Infinity;

    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const text = el.textContent?.trim();
      if (!text) continue;

      // "카테고리"를 포함하고, 다른 긴 텍스트는 아닌 것
      if (text.includes("카테고리") && text.length < 15) {
        const area = rect.width * rect.height;
        if (area < bestArea) {
          bestArea = area;
          bestMatch = { el, text, rect };
        }
      }
    }

    if (bestMatch) {
      bestMatch.el.click();
      return {
        method: "text-match",
        text: bestMatch.text,
        x: Math.round(bestMatch.rect.x),
        y: Math.round(bestMatch.rect.y),
        w: Math.round(bestMatch.rect.width),
        h: Math.round(bestMatch.rect.height),
      };
    }

    // 전략 2: class에 hamburger/category 포함
    for (const el of document.querySelectorAll("a, button, div")) {
      const cls = (el.className?.toString() || "").toLowerCase();
      if (cls.includes("hamburger") || cls.includes("category-btn") || cls.includes("all-menu")) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.y < 100) {
          el.click();
          return { method: "class-match", cls: cls.slice(0, 50), x: Math.round(rect.x), y: Math.round(rect.y) };
        }
      }
    }

    return null;
  });

  if (clicked) {
    console.log(`  클릭 성공 (${clicked.method}): "${clicked.text || clicked.cls}" (${clicked.x}, ${clicked.y})`);
  } else {
    // 최후 수단: 스크린샷 기준 좌표 직접 클릭 (파란 햄버거 버튼 영역)
    console.log("  자동 탐지 실패 — 좌상단 햄버거 버튼 좌표 직접 클릭");
    await page.mouse.click(45, 55);
  }

  // 메뉴 애니메이션 대기
  await new Promise((r) => setTimeout(r, 2000));

  // 메뉴가 열렸는지 확인: 대분류 이름이 보이는지
  const menuCheck = await page.evaluate((topNames) => {
    const links = document.querySelectorAll("a");
    for (const link of links) {
      const rect = link.getBoundingClientRect();
      if (rect.width === 0) continue;
      const text = link.textContent?.trim();
      if (topNames.some((n) => text === n || text?.includes(n))) {
        return true;
      }
    }
    return false;
  }, TOP_NAMES);

  if (!menuCheck) {
    console.log("  ⚠️ 메뉴가 안 열린 것 같습니다. 한번 더 클릭 시도...");
    await page.mouse.click(45, 55);
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log("  메뉴 열림 확인 완료");

  // ── 3) 1열(대분류) 확인 ──
  console.log("\n[1단계] 대분류 확인...");

  let allLinks = await getVisibleCategoryLinks(page);
  console.log(`  보이는 카테고리 링크: ${allLinks.length}개`);

  // 대분류 찾기: TOP_NAMES와 이름이 일치하는 것
  const level1Items = [];
  for (const topName of TOP_NAMES) {
    const found = allLinks.find((l) => l.name === topName || l.name.includes(topName) || topName.includes(l.name));
    if (found) {
      level1Items.push({ ...found, matchedName: topName });
    }
  }

  console.log(`  대분류 매칭: ${level1Items.length}/${TOP_NAMES.length}개`);

  if (level1Items.length === 0) {
    console.log("\n  ❌ 대분류를 찾을 수 없습니다.");
    console.log("  메뉴가 열려있는지 확인해주세요.");
    console.log("\n  현재 보이는 링크:");
    allLinks.slice(0, 20).forEach((l) => {
      console.log(`    "${l.name}" x:${l.x} y:${l.y}`);
    });
    await page.close();
    browser.close();
    process.exit(1);
  }

  level1Items.forEach((item, i) => {
    console.log(`  ${i + 1}. ${item.name} (${item.cx}, ${item.cy}) id:${item.id}`);
  });

  // ── 4) 각 대분류 hover → 중분류 수집 ──
  console.log("\n[2단계] 대분류 hover → 중분류 수집");

  const allCategories = [];
  const topIds = new Set();

  // 대분류 추가
  for (const item of level1Items) {
    topIds.add(item.id);
    allCategories.push({
      level: 1,
      name: item.name,
      url: item.url,
      id: item.id,
      parentId: null,
      parentName: null,
    });
  }

  // 대분류의 x좌표 범위
  const level1Xs = level1Items.map((i) => i.x);
  const col1MinX = Math.min(...level1Xs);
  const col1MaxX = Math.max(...level1Xs) + 100;

  for (let i = 0; i < level1Items.length; i++) {
    const parent = level1Items[i];
    console.log(`\n  [${i + 1}/${level1Items.length}] "${parent.name}" hover...`);

    // 대분류 항목에 마우스 hover
    await page.mouse.move(parent.cx, parent.cy, { steps: 5 });
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 500));

    // hover 후 보이는 모든 링크 가져오기
    const afterHover = await getVisibleCategoryLinks(page);

    // 2열(중분류) = 대분류 x 범위보다 오른쪽에 있는 것
    const midLinks = afterHover.filter((l) => {
      if (l.x <= col1MaxX) return false;      // 1열(대분류) 제외
      if (topIds.has(l.id)) return false;      // 대분류 id 제외
      if (TOP_NAMES.includes(l.name)) return false; // 대분류 이름 제외
      return true;
    });

    // 2열의 x좌표 범위 파악
    let col2Items = midLinks;
    if (midLinks.length > 0) {
      const midXs = midLinks.map((l) => l.x);
      const col2MinX = Math.min(...midXs);
      // 같은 열에 있는 것만 (x가 비슷한 것)
      col2Items = midLinks.filter((l) => l.x >= col2MinX && l.x <= col2MinX + 100);
    }

    // 중복 제거
    const seenIds = new Set(allCategories.map((c) => c.id));
    const newMids = [];
    for (const mid of col2Items) {
      if (!mid.id || seenIds.has(mid.id)) continue;
      seenIds.add(mid.id);
      newMids.push(mid);
      allCategories.push({
        level: 2,
        name: mid.name,
        url: mid.url,
        id: mid.id,
        parentId: parent.id,
        parentName: parent.name,
      });
    }

    if (newMids.length > 0) {
      console.log(`    중분류 ${newMids.length}개: ${newMids.map((m) => m.name).join(", ")}`);
    } else {
      console.log(`    중분류 없음`);
    }

    // ── 5) 각 중분류 hover → 소분류 수집 ──
    for (let j = 0; j < col2Items.length; j++) {
      const mid = col2Items[j];

      await page.mouse.move(mid.cx, mid.cy, { steps: 3 });
      await new Promise((r) => setTimeout(r, 500 + Math.random() * 300));

      const afterMidHover = await getVisibleCategoryLinks(page);

      // 3열(소분류) = 중분류 x보다 오른쪽
      const col2MaxX = (col2Items.length > 0 ? Math.max(...col2Items.map((l) => l.x)) : mid.x) + 100;
      const smallLinks = afterMidHover.filter((l) => {
        if (l.x <= col2MaxX) return false;
        if (topIds.has(l.id)) return false;
        if (seenIds.has(l.id)) return false;
        return true;
      });

      for (const small of smallLinks) {
        if (!small.id || seenIds.has(small.id)) continue;
        seenIds.add(small.id);
        allCategories.push({
          level: 3,
          name: small.name,
          url: small.url,
          id: small.id,
          parentId: mid.id,
          parentName: mid.name,
        });
      }

      if (smallLinks.length > 0) {
        console.log(`      ${mid.name} → 소분류 ${smallLinks.length}개: ${smallLinks.map((s) => s.name).join(", ")}`);
      }
    }

    // 대분류 사이 약간 대기
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
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
    console.log(`${top.name}`);
    console.log(`  ${top.url}`);

    const mids = allCategories.filter((c) => c.level === 2 && c.parentId === top.id);
    for (const mid of mids) {
      console.log(`\t${mid.name}`);
      console.log(`\t  ${mid.url}`);

      const smalls = allCategories.filter((c) => c.level === 3 && c.parentId === mid.id);
      for (const small of smalls) {
        console.log(`\t\t${small.name}`);
        console.log(`\t\t  ${small.url}`);
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
