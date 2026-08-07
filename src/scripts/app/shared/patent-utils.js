/**
 * PatentLens - 专利号码与同族匹配工具函数
 *
 * 修复公开号/专利号查询时，同一国家存在多个同族专利（如US的continuation/CIP/divisional）
 * 导致find(item => item.countryCode === office)返回错误条目的问题。
 *
 * 策略：拦截 gdFetch 返回的 family 数据，根据查询参数（queryType/office/docNum）
 * 将正确匹配的同族成员移到 list[0]，使原有代码的 find(countryCode) 逻辑自然命中正确条目。
 * 同时设置 corrAppNum 为正确的申请号。
 *
 * GD family.list 条目数据结构（基于代码分析）：
 *   - countryCode: 国家代码 (e.g. "US")
 *   - appNum / applicationNumber / docNumber: 申请号
 *   - publicationNumber: 公开号（完整字符串，可能带国家代码和kind code）
 *   - patentNumber: 专利号
 *   - title / inventionTitle: 标题
 *   - pubList: 公开信息数组 [{ pubCountry, pubNum, pubDate, pubDateStr }, ...]
 *     其中 pubNum 包含号码和可能的kind code（如 "20250144773A1"）
 */

(function() {
  'use strict';

  /**
   * 规范化号码用于比较（去掉非字母数字字符，转大写）
   */
  function normalizeNum(n) {
    if (n === undefined || n === null) return '';
    return String(n).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  }

  /**
   * 从号码字符串中分离数字部分和kind code
   * 输入如 "20250144773A1" 或 "US20250144773A1" → { num: "20250144773", kind: "A1" }
   */
  function splitNumAndKind(raw) {
    if (!raw) return { num: '', kind: '' };
    const s = String(raw).trim().replace(/\s+/g, '');
    // 去掉开头的国家代码（2个字母）
    const noCountry = s.replace(/^[A-Z]{2}/i, '');
    // 从末尾提取kind code（字母+可选数字，如A1, B2, A）
    const m = noCountry.match(/^([0-9]+)([A-Z]\d*)?$/i);
    if (m) {
      return { num: m[1] || '', kind: (m[2] || '').toUpperCase() };
    }
    // 特殊情况：如果全是数字
    if (/^[0-9]+$/.test(noCountry)) {
      return { num: noCountry, kind: '' };
    }
    return { num: noCountry.replace(/[A-Z]+\d*$/i, ''), kind: (noCountry.match(/([A-Z]\d*)$/i) || [,''])[1].toUpperCase() };
  }

  /**
   * 从pubList条目中提取 { num, kind }
   * pubList对象格式: { pubCountry, pubNum, pubDate, pubDateStr }
   */
  function extractFromPub(pub) {
    if (!pub) return { num: '', kind: '' };
    if (typeof pub === 'string') {
      return splitNumAndKind(pub);
    }
    if (typeof pub === 'object') {
      // 尝试多个字段
      const rawNum = pub.pubNum || pub.docNumber || pub.number || pub.publicationNumber
        || pub.pubNumber || pub.documentNumber || '';
      const rawKind = pub.kindCode || pub.kind || pub.documentKind || pub.docKind || '';
      if (rawKind) {
        // 如果有显式kind字段，num从rawNum中去掉kind后缀
        const split = splitNumAndKind(rawNum);
        return { num: normalizeNum(split.num), kind: normalizeNum(rawKind) };
      }
      const split = splitNumAndKind(rawNum);
      return { num: normalizeNum(split.num), kind: normalizeNum(split.kind) };
    }
    return { num: '', kind: '' };
  }

  /**
   * 检查给定的family条目是否与查询参数匹配
   * @param {Object} entry - family.list中的一个成员
   * @param {string} office - 国家代码 (如 "US")
   * @param {string} queryType - 查询类型: "application" | "publication" | "patent"
   * @param {string} queryNum - 查询号码（纯数字，如 "20250144773"）
   * @returns {boolean}
   */
  function isMatchingEntry(entry, office, queryType, queryNum) {
    if (!entry) return false;
    if ((entry.countryCode || entry.office || '').toUpperCase() !== (office || '').toUpperCase()) return false;

    const qNum = normalizeNum(queryNum);
    if (!qNum) return false;

    // 收集所有候选号码及其类型
    const candidates = [];

    // 申请号字段
    const appNumRaw = entry.appNum || entry.applicationNumber || entry.docNumber;
    if (appNumRaw) {
      const { num } = splitNumAndKind(appNumRaw);
      candidates.push({ num: normalizeNum(num), type: 'application' });
    }

    // docNum子对象
    if (entry.docNum && entry.docNum.docNumber) {
      const { num } = splitNumAndKind(entry.docNum.docNumber);
      candidates.push({ num: normalizeNum(num), type: 'application' });
    }

    // 公开号字段（直接字段）
    const pubRaw = entry.publicationNumber;
    if (pubRaw) {
      const { num } = splitNumAndKind(pubRaw);
      candidates.push({ num: normalizeNum(num), type: 'publication' });
    }

    // 专利号字段
    const patRaw = entry.patentNumber;
    if (patRaw) {
      const { num } = splitNumAndKind(patRaw);
      candidates.push({ num: normalizeNum(num), type: 'patent' });
    }

    // pubList数组
    if (Array.isArray(entry.pubList)) {
      for (const pub of entry.pubList) {
        const { num } = extractFromPub(pub);
        if (num) {
          candidates.push({ num, type: 'publication' });
        }
      }
    }

    // 评分匹配
    let bestScore = 0;
    for (const c of candidates) {
      let score = 0;
      // 号码匹配：完全相等或一方包含另一方（处理带前缀的情况）
      if (c.num === qNum) {
        score += 100;
      } else if (c.num.length >= qNum.length && c.num.endsWith(qNum)) {
        score += 90;
      } else if (qNum.length > c.num.length && qNum.endsWith(c.num)) {
        score += 80;
      } else {
        continue;
      }
      // 查询类型匹配加分
      if (queryType === 'application' && c.type === 'application') score += 20;
      if ((queryType === 'publication' || queryType === 'patent') && c.type === 'publication') score += 20;
      if (queryType === 'patent' && c.type === 'patent') score += 20;

      if (score > bestScore) bestScore = score;
    }
    return bestScore >= 80;
  }

  /**
   * 在family.list中找到与查询参数精确匹配的条目
   * @param {Array} familyList - family.list数组
   * @param {string} office - 国家代码
   * @param {string} queryType - 查询类型
   * @param {string} queryNum - 查询号码（纯数字）
   * @returns {Object|null} 匹配的条目或null
   */
  function findCorrectFamilyEntry(familyList, office, queryType, queryNum) {
    if (!Array.isArray(familyList)) return null;

    const qNum = normalizeNum(queryNum);
    if (!qNum) return familyList.find(item => (item.countryCode || item.office || '').toUpperCase() === (office || '').toUpperCase()) || null;

    // 第一轮：精确匹配，找最高分的条目
    let bestEntry = null;
    let bestScore = 0;

    for (const entry of familyList) {
      if ((entry.countryCode || entry.office || '').toUpperCase() !== (office || '').toUpperCase()) continue;

      // 收集号码并计算匹配分数
      let score = 0;
      const addScore = (rawNum, weight, type) => {
        if (!rawNum) return;
        const { num } = splitNumAndKind(rawNum);
        const n = normalizeNum(num);
        if (n === qNum) {
          let s = weight;
          if (queryType === 'application' && type === 'application') s += 10;
          if ((queryType === 'publication' || queryType === 'patent') && (type === 'publication' || type === 'patent')) s += 10;
          if (s > score) score = s;
        } else if (n.length >= qNum.length && n.endsWith(qNum)) {
          let s = weight - 10;
          if (s > score) score = s;
        }
      };

      addScore(entry.appNum || entry.applicationNumber || entry.docNumber, 100, 'application');
      if (entry.docNum) addScore(entry.docNum.docNumber, 95, 'application');
      addScore(entry.publicationNumber, 100, 'publication');
      addScore(entry.patentNumber, 100, 'patent');

      if (Array.isArray(entry.pubList)) {
        for (const pub of entry.pubList) {
          const { num } = extractFromPub(pub);
          if (num) {
            if (num === qNum) {
              let s = 80;
              if (queryType === 'publication' || queryType === 'patent') s += 10;
              if (s > score) score = s;
            } else if (num.endsWith(qNum) || qNum.endsWith(num)) {
              if (70 > score) score = 70;
            }
          }
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    }

    if (bestEntry && bestScore >= 70) return bestEntry;

    // 第二轮：宽松匹配（仅号码结尾匹配）
    for (const entry of familyList) {
      if ((entry.countryCode || entry.office || '').toUpperCase() !== (office || '').toUpperCase()) continue;
      const nums = [];
      const appRaw = entry.appNum || entry.applicationNumber || entry.docNumber;
      if (appRaw) nums.push(normalizeNum(splitNumAndKind(appRaw).num));
      if (entry.docNum?.docNumber) nums.push(normalizeNum(splitNumAndKind(entry.docNum.docNumber).num));
      if (entry.publicationNumber) nums.push(normalizeNum(splitNumAndKind(entry.publicationNumber).num));
      if (entry.patentNumber) nums.push(normalizeNum(splitNumAndKind(entry.patentNumber).num));
      if (Array.isArray(entry.pubList)) {
        for (const pub of entry.pubList) {
          const { num } = extractFromPub(pub);
          if (num) nums.push(num);
        }
      }
      for (const n of nums) {
        if (n === qNum || (n.length >= qNum.length && n.endsWith(qNum)) || (qNum.length > n.length && qNum.endsWith(n))) {
          return entry;
        }
      }
    }

    // 第三轮：回退到第一个同国家条目
    return familyList.find(item => (item.countryCode || item.office || '').toUpperCase() === (office || '').toUpperCase()) || null;
  }

  /**
   * 重新排序familyData.list，将匹配的条目移到第一位，并修正corrAppNum
   */
  function reorderFamilyList(familyData, office, queryType, queryNum) {
    if (!familyData || !Array.isArray(familyData.list)) return familyData;

    const correctEntry = findCorrectFamilyEntry(familyData.list, office, queryType, queryNum);
    if (!correctEntry) return familyData;

    // 将正确条目移到第一位
    if (familyData.list[0] !== correctEntry) {
      const idx = familyData.list.indexOf(correctEntry);
      if (idx > 0) {
        familyData.list.splice(idx, 1);
        familyData.list.unshift(correctEntry);
      }
    }

    // 修正corrAppNum为正确条目对应的申请号
    const correctAppNum = correctEntry.appNum || correctEntry.applicationNumber || correctEntry.docNumber
      || (correctEntry.docNum && correctEntry.docNum.docNumber);
    if (correctAppNum) {
      familyData.corrAppNum = correctAppNum;
    }

    return familyData;
  }

  /**
   * 解析GD family URL，提取queryType, office, docNum
   * URL格式: /patent-family/svc/family/{queryType}/{office}/{docNum}
   * docNum是纯数字（由parsePatentNumber预处理，已去掉kind code和国家代码前缀）
   */
  function parseFamilyUrl(urlPath) {
    const m = urlPath.match(/\/patent-family\/svc\/family\/(application|publication|patent)\/([^/]+)\/([^/?]+)/i);
    if (!m) return null;
    return {
      queryType: m[1].toLowerCase(),
      office: m[2].toUpperCase(),
      docNum: decodeURIComponent(m[3]),
    };
  }

  /**
   * 安装gdFetch拦截器：在family数据返回后自动重排list
   */
  function installGdFetchInterceptor() {
    // gdFetch在web-app.js中定义为顶层async function，会成为window的属性。
    // 使用短轮询等待它可用（在同步脚本加载链中，50ms内即可用）。
    const checkInterval = setInterval(() => {
      if (typeof window.gdFetch !== 'function') return;
      clearInterval(checkInterval);

      const originalGdFetch = window.gdFetch;
      window.gdFetch = async function patchedGdFetch(urlPath) {
        const result = await originalGdFetch.apply(this, arguments);
        try {
          const parsed = parseFamilyUrl(urlPath);
          if (parsed && result && Array.isArray(result.list)) {
            reorderFamilyList(result, parsed.office, parsed.queryType, parsed.docNum);
          }
        } catch (e) {
          console.warn('[patent-utils] family reorder failed:', e);
        }
        return result;
      };
      console.info('[patent-utils] gdFetch interceptor installed (family list reordering for correct family-member matching)');
    }, 50);

    // 5秒后停止检查，防止无限轮询
    setTimeout(() => clearInterval(checkInterval), 5000);
  }

  // 暴露工具函数到全局，供可能的直接调用/调试使用
  window.findCorrectFamilyEntry = findCorrectFamilyEntry;
  window.reorderFamilyList = reorderFamilyList;

  // 安装拦截器
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installGdFetchInterceptor);
  } else {
    installGdFetchInterceptor();
  }
})();
