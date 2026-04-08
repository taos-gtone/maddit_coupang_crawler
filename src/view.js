/**
 * 크롤링 결과 조회 유틸리티
 *
 * 사용법:
 *   node src/view.js                    # 최신 요약 보기
 *   node src/view.js --date 2026-04-08  # 특정 날짜
 *   node src/view.js --min-reviews 10000 # 리뷰 N개 이상 필터
 */
import { existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSummary } from "./storage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { date: null, minReviews: 0 };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--date" && args[i + 1]) opts.date = args[++i];
    if (args[i] === "--min-reviews" && args[i + 1]) opts.minReviews = parseInt(args[++i], 10);
  }
  return opts;
}

function getLatestDate() {
  if (!existsSync(DATA_DIR)) return null;
  const dirs = readdirSync(DATA_DIR)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();
  return dirs[0] || null;
}

function main() {
  const opts = parseArgs();
  const date = opts.date || getLatestDate();

  if (!date) {
    console.log("크롤링 데이터가 없습니다. 먼저 크롤러를 실행해주세요:");
    console.log("  npm run crawl");
    process.exit(1);
  }

  const summary = loadSummary(date);
  if (!summary) {
    console.log(`${date} 데이터를 찾을 수 없습니다.`);
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log(`쿠팡 크롤링 결과 — ${summary.date}`);
  console.log(`수집 시각: ${summary.crawledAt}`);
  console.log("=".repeat(60));

  // 카테고리별 요약
  console.log("\n[카테고리별 요약]");
  summary.byCategory.forEach((c) => {
    console.log(`  ${c.category}: ${c.count}개 상품 | 1위: ${c.topProduct} (${c.topReviews.toLocaleString()}개 리뷰)`);
  });

  // 필터링된 상품
  const minReviews = opts.minReviews || 10000;
  const filtered = summary.topByReviews.filter((p) => p.reviewCount >= minReviews);

  console.log(`\n[리뷰 ${minReviews.toLocaleString()}개 이상 상품] (${filtered.length}개)`);
  if (filtered.length === 0) {
    console.log("  해당 조건의 상품이 없습니다.");
  } else {
    filtered.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name}`);
      console.log(`     리뷰: ${p.reviewCount.toLocaleString()}개 | 카테고리: ${p.category}`);
    });
  }

  // 리뷰 10만+ 하이라이트
  if (summary.over100k.length > 0) {
    console.log(`\n[리뷰 10만개 이상 상품] (${summary.over100k.length}개)`);
    summary.over100k.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name} — ${p.reviewCount.toLocaleString()}개 [${p.category}]`);
    });
  }
}

main();
