import fs from 'fs';
import {
  resolveDataForSeoAuth,
  getDataForSeoBacklinksSummary,
  getDataForSeoBacklinksList,
  getDataForSeoReferringDomains,
  getDataForSeoKeywordDifficulty,
  getDataForSeoSerpWhoIsRanking,
  getDataForSeoSerpCompetitors,
  getDataForSeoRankedKeywords,
} from '../src/dataforseo.ts';

const envText = fs.readFileSync('.dev.vars', 'utf-8');
const env = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

async function runTests() {
  console.log('--- 1. Testing Auth Resolution ---');
  const auth = resolveDataForSeoAuth(undefined, undefined, undefined, env);
  console.log('Auth header resolved successfully (starts with Basic):', auth.startsWith('Basic '));

  console.log('\n--- 2. Testing Backlinks Summary ---');
  const summary = await getDataForSeoBacklinksSummary('aiskyla.com', {}, auth);
  console.log('Target:', summary.target);
  console.log('Domain Rank (0-1000):', summary.rank);
  console.log('Authority Score (0-100):', summary.authorityScore);
  console.log('Total Backlinks:', summary.totalBacklinks);
  console.log('Referring Domains:', summary.referringDomains);
  console.log('Broken Backlinks:', summary.brokenBacklinks);
  console.log('Dofollow Breakdown:', summary.dofollowBreakdown);

  console.log('\n--- 3. Testing Backlinks List ---');
  const blList = await getDataForSeoBacklinksList('aiskyla.com', { limit: 3 }, auth);
  console.log('Backlinks returned:', blList.totalReturned);
  if (blList.items.length > 0) {
    console.log('Sample Backlink:', {
      sourceDomain: blList.items[0].sourceDomain,
      anchor: blList.items[0].anchorText,
      dofollow: blList.items[0].isDofollow,
      rank: blList.items[0].backlinkRank,
    });
  }

  console.log('\n--- 4. Testing Referring Domains ---');
  const refDomains = await getDataForSeoReferringDomains('aiskyla.com', { limit: 3 }, auth);
  console.log('Referring Domains returned:', refDomains.totalReturned);
  if (refDomains.items.length > 0) {
    console.log('Sample Referring Domain:', refDomains.items[0]);
  }

  console.log('\n--- 5. Testing Keyword Difficulty ---');
  const kd = await getDataForSeoKeywordDifficulty(['best ai gifting platform', 'seo tools'], {}, auth);
  console.log('Average KD:', kd.averageDifficulty);
  for (const item of kd.items) {
    console.log(`[${item.tier}] "${item.keyword}" -> KD: ${item.keywordDifficulty} | ${item.rankingEffort}`);
  }

  console.log('\n--- 6. Testing SERP Who Is Ranking ---');
  const serp = await getDataForSeoSerpWhoIsRanking('best ai gifting platform', { depth: 10 }, auth);
  console.log('Keyword:', serp.keyword);
  console.log('AI Overview detected:', Boolean(serp.aiOverview?.detected));
  console.log('Top 3 Organic Ranking Domains:', serp.topRankingDomains.slice(0, 3));

  console.log('\n--- 7. Testing SERP Competitors ---');
  const comp = await getDataForSeoSerpCompetitors(['seo tools', 'keyword research'], {}, auth);
  console.log('Competitors found:', comp.competitorCount);
  if (comp.competitors.length > 0) {
    console.log('Top Competitor:', comp.competitors[0].domain, '| Avg Pos:', comp.competitors[0].avgPosition, '| ETV:', comp.competitors[0].estimatedTrafficVolume);
  }

  console.log('\n--- 8. Testing Domain Ranked Keywords ---');
  const rankedKw = await getDataForSeoRankedKeywords('aiskyla.com', { limit: 3 }, auth);
  console.log('Ranked Keywords returned:', rankedKw.totalReturned);
  if (rankedKw.items.length > 0) {
    console.log('Sample Ranked Keyword:', {
      keyword: rankedKw.items[0].keyword,
      rank: rankedKw.items[0].rank,
      url: rankedKw.items[0].url,
      volume: rankedKw.items[0].searchVolume,
      kd: rankedKw.items[0].keywordDifficulty,
    });
  }

  console.log('\nALL 7 DATAFORSEO ENDPOINTS AND WRAPPERS TESTED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
