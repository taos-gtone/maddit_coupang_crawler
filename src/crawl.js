/**
 * 쿠팡 카테고리별 리뷰 상위 상품 크롤러 v3
 *
 * 전략: 내 PC의 진짜 Chrome에 CDP로 연결
 * → Akamai가 탐지하는 자동화 Chromium 대신 진짜 브라우저 사용
 * → TLS fingerprint, 쿠키, 세션 모두 진짜
 *
 * 사용법:
 *   1) Chrome을 디버그 모드로 실행 (start-chrome.bat 사용)
 *   2) node src/crawl.js [--category 식품] [--top 50]
 */
import { chromium } from "playwright";
import { CATEGORIES } from "./categories.js";
import { saveResults, saveSummary } from "./storage.js";
import {
  randomDelay,
  humanScroll,
  humanMouseMove,
  randomHover,
} from "./stealth.js";

const CDP_URL = "http://localhost:9222";

/** CLI 인자 파싱 */
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { category: null, top: 50 };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--category" && args[i + 1]) opts.category = args[++i];
    if (args[i] === "--top" && args[i + 1]) opts.top = parseInt(args[++i], 10);
  }
  return opts;
}

/** 진짜 Chrome에 CDP 연결 */
async function connectToChrome() {
  try {
    const browser = await chromium.connectOverCDP(CDP_URL);
    console.log("✅ Chrome 연결 성공!");
    return browser;
  } catch (err) {
    console.error("❌ Chrome 연결 실패!");
    console.error("");
    console.error("Chrome을 디버그 모드로 먼저 실행해주세요:");
    console.error("");
    console.error("  방법 1) start-chrome.bat 더블클릭");
    console.error('  방법 2) 터미널에서: start chrome --remote-debugging-port=9222 --user-data-dir="%TEMP%\\chrome-debug"');
    console.error("");
    console.error("※ 이미 Chrome이 실행 중이면 모두 닫고 다시 시작해주세요.");
    process.exit(1);
  }
}

/** 페이지에서 상품 목록 추출 */
async function extractProducts(page) {
  return page.evaluate(() => {
    const items = [];
    const productCards = document.querySelectorAll(
      "#productList .baby-product, .search-product, [class*='product-item'], li.search-product"
    );

    productCards.forEach((card) => {
      try {
        const nameEl =
          card.querySelector(".name, .descriptions .name, [class*='name']") ||
          card.querySelector("a[href*='/vp/products/']");
        const name = nameEl?.textContent?.trim() || "";

        const ratingCountEl = card.querySelector(
          ".rating-total-count, [class*='rating-total-count'], .count"
        );
        let reviewCount = 0;
        if (ratingCountEl) {
          const text = ratingCountEl.textContent.replace(/[^0-9]/g, "");
          reviewCount = parseInt(text, 10) || 0;
        }

        const priceEl = card.querySelector(
          ".price-value, [class*='price'] strong, .base-price"
        );
        const price = priceEl?.textContent?.trim() || "";

        const ratingEl = card.querySelector(".rating, [class*='star']");
        const rating = ratingEl?.textContent?.trim() || "";

        const linkEl = card.querySelector("a[href*='/vp/products/']");
        const link = linkEl
          ? "https://www.coupang.com" + linkEl.getAttribute("href")
          : "";

        if (name && name.length > 0) {
          items.push({ name, reviewCount, price, rating, link });
        }
      } catch {
        // skip
      }
    });

    return items;
  });
}

/** CAPTCHA/차단 감지 */
async function detectBlock(page) {
  try {
    const content = await page.content();
    return (
      content.includes("Access Denied") ||
      content.includes("Reference #") ||
      content.includes("errors.edgesuite.net") ||
      content.includes("자동 접속") ||
      content.includes("비정상적인 접근") ||
      content.includes("captcha")
    );
  } catch {
    return false;
  }
}

/** 차단 시 복구: 사용자에게 수동 해제 요청 */
async function handleBlock(page) {
  console.log("");
  console.log("  ⚠️  Akamai 차단 감지!");
  console.log("  → Chrome 브라우저에서 직접 쿠팡에 접속해서 페이지를 확인해주세요.");
  console.log("  → 확인 후 자동으로 계속 진행됩니다. (최대 60초 대기)");
  console.log("");

  // 최대 60초 동안 차단 해제 대기
  for (let i = 0; i < 12; i++) {
    await randomDelay(5000, 5000);
    const stillBlocked = await detectBlock(page);
    if (!stillBlocked) {
      console.log("  ✅ 차단 해제됨! 계속 진행합니다.");
      return true;
    }
    console.log(`  ⏳ 대기 중... (${(i + 1) * 5}초)`);
  }

  console.log("  ❌ 차단 해제 실패 — 이 카테고리 건너뜁니다.");
  return false;
}

/** 카테고리 크롤링 (멀티 페이지) */
async function crawlCategory(page, category, maxPages, topN) {
  console.log(`\n[${"━".repeat(50)}]`);
  console.log(`[${category.name}] 크롤링 시작`);
  let allProducts = [];

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const url = `${category.url}?page=${pageNum}`;
    console.log(`  페이지 ${pageNum}/${maxPages}...`);

    try {
      // 사람처럼 행동 후 이동
      if (pageNum > 1) {
        await humanMouseMove(page);
        await randomDelay(1500, 3000);
      }

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await randomDelay(2000, 4000);

      // 차단 감지
      if (await detectBlock(page)) {
        const recovered = await handleBlock(page);
        if (!recovered) break;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await randomDelay(2000, 4000);
      }

      // 첫 페이지에서 판매량순 정렬
      if (pageNum === 1) {
        try {
          const sortBtn = await page.$(
            'button:has-text("판매량순"), a:has-text("판매량순")'
          );
          if (sortBtn) {
            await humanMouseMove(page);
            await randomDelay(500, 1000);
            await sortBtn.click();
            await randomDelay(2000, 4000);
          }
        } catch {
          // 정렬 실패 무시
        }
      }

      // 사람처럼 탐색
      await humanScroll(page);
      await randomHover(page);
      await randomDelay(500, 1500);

      // 상품 추출
      const products = await extractProducts(page);
      allProducts.push(...products);
      console.log(`  → ${products.length}개 상품 발견`);

      // 다음 페이지 전 대기
      if (pageNum < maxPages) {
        await randomDelay(5000, 12000);
      }
    } catch (err) {
      console.error(`  페이지 ${pageNum} 실패: ${err.message}`);
      await randomDelay(5000, 10000);
    }
  }

  // 중복 제거 후 정렬
  const unique = new Map();
  for (const p of allProducts) {
    if (!unique.has(p.name) || unique.get(p.name).reviewCount < p.reviewCount) {
      unique.set(p.name, p);
    }
  }

  const sorted = [...unique.values()]
    .sort((a, b) => b.reviewCount - a.reviewCount)
    .slice(0, topN);

  console.log(`  총 ${allProducts.length}개 → 중복 제거 → 상위 ${sorted.length}개`);
  if (sorted.length > 0) {
    console.log(
      `  최다 리뷰: "${sorted[0].name}" (${sorted[0].reviewCount.toLocaleString()}개)`
    );
  }

  return sorted;
}

/** 메인 실행 */
async function main() {
  const opts = parseArgs();
  const categories = opts.category
    ? CATEGORIES.filter((c) => c.name.includes(opts.category))
    : CATEGORIES;

  if (categories.length === 0) {
    console.error(`카테고리 "${opts.category}"를 찾을 수 없습니다.`);
    console.log(`사용 가능: ${CATEGORIES.map((c) => c.name).join(", ")}`);
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log("쿠팡 크롤러 v3 (진짜 Chrome CDP 연결)");
  console.log(`시작: ${new Date().toLocaleString("ko-KR")}`);
  console.log(`대상: ${categories.map((c) => c.name).join(", ")}`);
  console.log("=".repeat(60));

  // ── 진짜 Chrome에 연결 ──
  const browser = await connectToChrome();
  const context = browser.contexts()[0] || await browser.newContext();
  const page = await context.newPage();

  // 먼저 쿠팡 메인에 접속 확인
  console.log("\n쿠팡 메인 페이지 접속 확인...");
  await page.goto("https://www.coupang.com", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await randomDelay(2000, 4000);

  if (await detectBlock(page)) {
    console.log("\n⚠️  메인 페이지부터 차단됨!");
    console.log("Chrome 브라우저에서 직접 www.coupang.com에 접속해보세요.");
    console.log("접속 성공 후 이 크롤러를 다시 실행해주세요.");
    await page.close();
    await browser.close();
    process.exit(1);
  }

  console.log("✅ 쿠팡 접속 성공!\n");
  await humanScroll(page);
  await randomDelay(2000, 4000);

  // ── 카테고리별 크롤링 ──
  const allResults = [];

  for (let i = 0; i < categories.length; i++) {
    const category = categories[i];
    const products = await crawlCategory(page, category, 3, opts.top);

    if (products.length > 0) {
      saveResults(category.name, products);
      allResults.push({ category: category.name, products });
    }

    // 다음 카테고리 전 긴 대기
    if (i < categories.length - 1) {
      const waitSec = 45 + Math.floor(Math.random() * 75);
      console.log(`\n  ⏳ 다음 카테고리까지 ${waitSec}초 대기...`);
      await humanMouseMove(page);
      await randomDelay(waitSec * 1000, waitSec * 1000 + 5000);
    }
  }

  // ── 결과 요약 ──
  if (allResults.length > 0) {
    const summary = saveSummary(allResults);

    console.log("\n" + "=".repeat(60));
    console.log("크롤링 완료!");
    console.log("=".repeat(60));

    if (summary.over100k.length > 0) {
      console.log("\n리뷰 10만개 이상 상품:");
      summary.over100k.forEach((p, i) => {
        console.log(
          `  ${i + 1}. ${p.name} (${p.reviewCount.toLocaleString()}개) [${p.category}]`
        );
      });
    }

    console.log("\n전체 리뷰 Top 10:");
    summary.topByReviews.slice(0, 10).forEach((p, i) => {
      console.log(
        `  ${i + 1}. ${p.name} (${p.reviewCount.toLocaleString()}개) [${p.category}]`
      );
    });
  } else {
    console.log("\n⚠️ 수집된 데이터가 없습니다.");
  }

  await page.close();
  // CDP 연결은 브라우저를 종료하지 않음 (사용자 Chrome 유지)
  browser.close();
}

main().catch(console.error);
