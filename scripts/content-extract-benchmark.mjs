#!/usr/bin/env node
/**
 * Content Extraction Benchmark — sed vs Readability
 * Compares current sed-based extraction with @mozilla/readability
 * Outputs: token count, noise ratio, content quality metrics
 */

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { execSync } from 'node:child_process';

const TEST_URLS = [
  'https://simonwillison.net/2026/Mar/6/',          // blog post
  'https://news.ycombinator.com',                    // list page
  'https://lobste.rs',                               // list page
  'https://github.com/nicepkg/defuddle',             // GitHub README
  'https://dev.to',                                  // content platform
];

// Current sed-based extraction (replicates web-fetch.sh logic)
function sedExtract(html) {
  // Same as web-fetch.sh lines 160-164
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

// Readability-based extraction
function readabilityExtract(html, url) {
  try {
    const { document } = parseHTML(html);
    const reader = new Readability(document);
    const article = reader.parse();
    if (!article) return { text: '', title: '', failed: true };
    return {
      text: article.textContent.replace(/\s+/g, ' ').trim(),
      title: article.title,
      failed: false,
    };
  } catch (e) {
    return { text: '', title: '', failed: true, error: e.message };
  }
}

// Noise indicators
function countNoise(text) {
  const noisePatterns = [
    /sign up/gi, /log in/gi, /subscribe/gi, /newsletter/gi,
    /cookie/gi, /privacy policy/gi, /terms of service/gi,
    /©\s*\d{4}/g, /all rights reserved/gi,
    /navigation/gi, /menu/gi, /sidebar/gi, /footer/gi,
    /share on/gi, /follow us/gi, /advertisement/gi,
  ];
  let count = 0;
  for (const p of noisePatterns) {
    const matches = text.match(p);
    if (matches) count += matches.length;
  }
  return count;
}

// Rough token estimate (chars / 4 for English, chars / 2 for mixed)
function estimateTokens(text) {
  return Math.ceil(text.length / 3.5);
}

async function fetchURL(url) {
  try {
    const html = execSync(
      `curl -sL --max-time 10 --compressed -H "User-Agent: Mozilla/5.0" "${url}"`,
      { maxBuffer: 5 * 1024 * 1024, encoding: 'utf-8' }
    );
    return html;
  } catch {
    return null;
  }
}

async function main() {
  console.log('=== Content Extraction Benchmark ===\n');
  console.log(`${'URL'.padEnd(35)} | ${'Method'.padEnd(12)} | ${'Chars'.padStart(7)} | ${'Tokens'.padStart(7)} | ${'Noise'.padStart(5)} | Notes`);
  console.log('-'.repeat(100));

  const results = [];

  for (const url of TEST_URLS) {
    const domain = new URL(url).hostname.replace('www.', '');
    const shortDomain = domain.length > 33 ? domain.slice(0, 30) + '...' : domain;

    const html = await fetchURL(url);
    if (!html) {
      console.log(`${shortDomain.padEnd(35)} | ${'FAILED'.padEnd(12)} | ${'-'.padStart(7)} | ${'-'.padStart(7)} | ${'-'.padStart(5)} | fetch failed`);
      continue;
    }

    const htmlSize = html.length;

    // sed extraction
    const sedText = sedExtract(html);
    const sedTokens = estimateTokens(sedText);
    const sedNoise = countNoise(sedText);

    // readability extraction
    const rResult = readabilityExtract(html, url);
    const rText = rResult.text;
    const rTokens = estimateTokens(rText);
    const rNoise = countNoise(rText);

    console.log(`${shortDomain.padEnd(35)} | ${'sed'.padEnd(12)} | ${String(sedText.length).padStart(7)} | ${String(sedTokens).padStart(7)} | ${String(sedNoise).padStart(5)} | HTML: ${htmlSize}`);

    if (rResult.failed) {
      console.log(`${' '.repeat(35)} | ${'readability'.padEnd(12)} | ${'-'.padStart(7)} | ${'-'.padStart(7)} | ${'-'.padStart(5)} | FAILED: ${rResult.error || 'no article'}`);
    } else {
      const reduction = sedText.length > 0 ? Math.round((1 - rText.length / sedText.length) * 100) : 0;
      const noiseReduction = sedNoise > 0 ? Math.round((1 - rNoise / sedNoise) * 100) : 0;
      console.log(`${' '.repeat(35)} | ${'readability'.padEnd(12)} | ${String(rText.length).padStart(7)} | ${String(rTokens).padStart(7)} | ${String(rNoise).padStart(5)} | -${reduction}% chars, -${noiseReduction}% noise`);
    }

    results.push({ domain, htmlSize, sedChars: sedText.length, sedTokens, sedNoise, rChars: rText.length, rTokens, rNoise, rFailed: rResult.failed });
  }

  // Summary
  const valid = results.filter(r => !r.rFailed);
  if (valid.length > 0) {
    const avgCharReduction = Math.round(valid.reduce((s, r) => s + (1 - r.rChars / r.sedChars), 0) / valid.length * 100);
    const avgNoiseReduction = valid.filter(r => r.sedNoise > 0).length > 0
      ? Math.round(valid.filter(r => r.sedNoise > 0).reduce((s, r) => s + (1 - r.rNoise / r.sedNoise), 0) / valid.filter(r => r.sedNoise > 0).length * 100)
      : 0;
    const totalSedTokens = valid.reduce((s, r) => s + r.sedTokens, 0);
    const totalRTokens = valid.reduce((s, r) => s + r.rTokens, 0);

    console.log('\n=== Summary ===');
    console.log(`Tested: ${results.length} URLs (${valid.length} readability succeeded, ${results.length - valid.length} failed)`);
    console.log(`Avg char reduction: ${avgCharReduction}%`);
    console.log(`Avg noise reduction: ${avgNoiseReduction}%`);
    console.log(`Total tokens — sed: ${totalSedTokens}, readability: ${totalRTokens} (saved ${totalSedTokens - totalRTokens})`);
  }
}

main().catch(console.error);
