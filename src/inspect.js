/**
 * 쿠팡 페이지에서 상품명 + 리뷰 수 + URL 추출 (3페이지 크롤링)
 *
 * 사용법:
 *   node src/inspect.js --url "https://www.coupang.com/np/categories/194276"
 *   node src/inspect.js --url "https://www.coupang.com/np/categories/194276" --pages 5
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEBUG_DIR = join(__dirname, "..", "data", "debug");

/** CLI 인자 파싱 */
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { url: null, pages: 3 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && args[i + 1]) opts.url = args[++i];
    if (args[i] === "--pages" && args[i + 1]) opts.pages = parseInt(args[++i], 10);
  }
  return opts;
}

/** 사람처럼 스크롤 */
async function scrollPage(page) {
  for (let i = 0; i < 15; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 400));
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 800));
}

/** 현재 페이지에서 DOM 기반 상품 추출 */
async function extractFromPage(page) {
  return page.evaluate(() => {
    const results = [];
    const allElements = document.querySelectorAll("*");

    for (const el of allElements) {
      const ownText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join("");

      const match = ownText.match(/\((\d[\d,]+)\)/);
      if (!match) continue;

      const num = parseInt(match[1].replace(/,/g, ""), 10);
      if (num < 100) continue;

      const card =
        el.closest("li") ||
        el.closest("article") ||
        el.closest("[class*='product']") ||
        el.closest("a[href*='products']")?.parentElement ||
        el.parentElement?.parentElement?.parentElement;
      if (!card) continue;

      // 링크
      const linkEl =
        card.querySelector("a[href*='/vp/products/']") ||
        card.querySelector("a[href*='/products/']") ||
        card.querySelector("a[href*='itemId=']");
      const href = linkEl?.getAttribute("href") || "";
      let url = "";
      if (href.startsWith("http")) url = href;
      else if (href.startsWith("/")) url = "https://www.coupang.com" + href;

      // 상품명 (여러 전략)
      let name = "";
      const titleEl = card.querySelector("[title]");
      if (titleEl?.getAttribute("title")?.length > 3) {
        name = titleEl.getAttribute("title");
      }
      if (!name && linkEl) {
        name = linkEl.getAttribute("title") || "";
        if (!name) {
          const texts = [];
          linkEl.querySelectorAll("*").forEach((child) => {
            const t = child.textContent?.trim();
            if (t && t.length > 5 && !t.match(/^\(?\d/) && !t.includes("★")) {
              texts.push(t);
            }
          });
          name = texts.sort((a, b) => b.length - a.length)[0] || "";
        }
      }
      if (!name) {
        const nameEl = card.querySelector(
          "[class*='name'], [class*='title'], [class*='description'], [class*='Name'], [class*='Title']"
        );
        if (nameEl) name = nameEl.textContent?.trim() || "";
      }
      if (!name) {
        const imgEl = card.querySelector("img[alt]");
        if (imgEl?.getAttribute("alt")?.length > 3) name = imgEl.getAttribute("alt");
      }
      if (!name) {
        const lines = (card.innerText || "").split("\n").filter((l) => l.trim().length > 5);
        name = lines[0]?.trim() || "";
      }
      if (name.length > 120) name = name.slice(0, 120) + "...";

      results.push({
        reviewCount: num,
        name: name || "(이름 없음)",
        url: url || "(링크 없음)",
      });
    }

    const seen = new Set();
    return results.filter((r) => {
      const key = `${r.reviewCount}-${r.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
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
  let page;

  if (opts.url) {
    page = await context.newPage();
  } else {
    page = context.pages().find((p) => p.url().includes("coupang.com"));
    if (!page) {
      console.log("Chrome에서 쿠팡 페이지를 먼저 열어주세요.");
      process.exit(1);
    }
    // 현재 열린 페이지면 1페이지만
    opts.pages = 1;
    opts.url = page.url();
  }

  if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true });

  console.log("=".repeat(60));
  console.log(`쿠팡 상품 탐색 (${opts.pages}페이지)`);
  console.log(`URL: ${opts.url}`);
  console.log("=".repeat(60));

  // ── 멀티 페이지 크롤링 ──
  let allProducts = [];

  for (let pageNum = 1; pageNum <= opts.pages; pageNum++) {
    const pageUrl = pageNum === 1 ? opts.url : `${opts.url}?page=${pageNum}`;
    console.log(`\n[페이지 ${pageNum}/${opts.pages}] ${pageUrl}`);

    try {
      await page.goto(pageUrl, { waitUntil: "load", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 3000 + Math.random() * 2000));

      // 스크롤해서 lazy load 로드
      await scrollPage(page);

      // 상품 추출
      const products = await extractFromPage(page);
      console.log(`  → ${products.length}개 상품 발견`);

      allProducts.push(...products);

      // 다음 페이지 전 대기
      if (pageNum < opts.pages) {
        const wait = 5 + Math.floor(Math.random() * 8);
        console.log(`  ⏳ ${wait}초 대기...`);
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
    } catch (err) {
      console.error(`  페이지 ${pageNum} 실패: ${err.message}`);
    }
  }

  // ── 중복 제거 + 정렬 ──
  const unique = new Map();
  for (const p of allProducts) {
    const key = p.url !== "(링크 없음)" ? p.url : `${p.name}-${p.reviewCount}`;
    if (!unique.has(key) || unique.get(key).reviewCount < p.reviewCount) {
      unique.set(key, p);
    }
  }

  const sorted = [...unique.values()].sort((a, b) => b.reviewCount - a.reviewCount);

  // ── 결과 출력 ──
  console.log("\n" + "=".repeat(60));
  console.log(`총 ${sorted.length}개 상품 (${opts.pages}페이지, 중복 제거 후)`);
  console.log("=".repeat(60));

  sorted.slice(0, 50).forEach((p, i) => {
    console.log(`\n  ${String(i + 1).padStart(2)}. [리뷰 ${p.reviewCount.toLocaleString()}개]`);
    console.log(`      상품명: ${p.name}`);
    console.log(`      URL: ${p.url}`);
  });

  // 리뷰 10만+ 하이라이트
  const over100k = sorted.filter((p) => p.reviewCount >= 100000);
  if (over100k.length > 0) {
    console.log(`\n\n${"★".repeat(30)}`);
    console.log(`리뷰 10만개 이상: ${over100k.length}개`);
    console.log(`${"★".repeat(30)}`);
    over100k.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name} — ${p.reviewCount.toLocaleString()}개`);
      console.log(`     ${p.url}`);
    });
  }

  // ── 파일 저장 ──
  const result = {
    url: opts.url,
    pages: opts.pages,
    timestamp: new Date().toISOString(),
    totalProducts: sorted.length,
    over100k: over100k.length,
    products: sorted,
  };
  const resultPath = join(DEBUG_DIR, "results.json");
  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf-8");
  console.log(`\n결과 저장: ${resultPath}`);

  if (opts.url) await page.close();
  browser.close();
  console.log("완료!");
}

main().catch(console.error);
