/**
 * 파일 기반 결과 저장
 * data/ 디렉토리에 날짜별 JSON 파일로 저장
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

/** 오늘 날짜 문자열 (YYYY-MM-DD) */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/** 크롤링 결과 파일로 저장 */
export function saveResults(categoryName, products) {
  const dateDir = join(DATA_DIR, today());
  if (!existsSync(dateDir)) {
    mkdirSync(dateDir, { recursive: true });
  }

  const filePath = join(dateDir, `${categoryName}.json`);
  const data = {
    category: categoryName,
    crawledAt: new Date().toISOString(),
    totalProducts: products.length,
    products,
  };

  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`  저장 완료: ${filePath} (${products.length}개 상품)`);
  return filePath;
}

/** 오늘의 전체 결과를 하나의 요약 파일로 병합 */
export function saveSummary(allResults) {
  const dateDir = join(DATA_DIR, today());
  if (!existsSync(dateDir)) {
    mkdirSync(dateDir, { recursive: true });
  }

  // 리뷰 수 기준 전체 순위
  const allProducts = allResults
    .flatMap((r) => r.products.map((p) => ({ ...p, category: r.category })))
    .sort((a, b) => b.reviewCount - a.reviewCount);

  const summary = {
    date: today(),
    crawledAt: new Date().toISOString(),
    totalCategories: allResults.length,
    totalProducts: allProducts.length,
    topByReviews: allProducts.slice(0, 50),
    over100k: allProducts.filter((p) => p.reviewCount >= 100_000),
    over10k: allProducts.filter((p) => p.reviewCount >= 10_000),
    byCategory: allResults.map((r) => ({
      category: r.category,
      count: r.products.length,
      topProduct: r.products[0]?.name || "없음",
      topReviews: r.products[0]?.reviewCount || 0,
    })),
  };

  const filePath = join(dateDir, "_summary.json");
  writeFileSync(filePath, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`\n요약 저장: ${filePath}`);
  console.log(`  총 상품: ${summary.totalProducts}개`);
  console.log(`  리뷰 10만+ 상품: ${summary.over100k.length}개`);
  console.log(`  리뷰 1만+ 상품: ${summary.over10k.length}개`);

  return summary;
}

/** 특정 날짜의 요약 파일 읽기 */
export function loadSummary(date) {
  const filePath = join(DATA_DIR, date, "_summary.json");
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8"));
}
