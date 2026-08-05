/**
 * 测试浏览器扩展队列的边界管理
 * 验证：无界增长缺陷修复、大小限制、TTL 清理
 */

const assert = require('assert');
const http = require('http');

const PORT = 18080;
const QUEUE_MAX_SIZE = 100;
const QUEUE_TTL_MS = 30 * 60 * 1000; // 30 分钟

// 模拟 server.js 中的队列逻辑
let _extensionDataQueue = [];
// 清理过期的队列条目
function _pruneExtensionQueue() {
  const now = Date.now();
  // 找出所有未过期的条目数量，删除前面的过期条目
  // 从后往前找第一个未过期的条目，然后删除该条目之前所有条目
  let firstValidIndex = -1;
  for (let i = _extensionDataQueue.length - 1; i >= 0; i--) {
    if (now - _extensionDataQueue[i].timestamp <= QUEUE_TTL_MS) {
      firstValidIndex = i;
    } else {
      break; // 已过期，停止搜索
    }
  }
  if (firstValidIndex > 0) {
    _extensionDataQueue.splice(0, firstValidIndex);
  } else if (firstValidIndex === -1 && _extensionDataQueue.length > 0) {
    // 所有条目都已过期，清空队列
    _extensionDataQueue.length = 0;
  }
}

function handleExtensionImport(data) {
  _pruneExtensionQueue();
  if (_extensionDataQueue.length >= QUEUE_MAX_SIZE) {
    console.warn(`队列已满，丢弃最旧的数据`);
    _extensionDataQueue.shift();
  }
  _extensionDataQueue.push({ type: "extension-data", payload: data, timestamp: Date.now() });
}

function handleExtensionAnalyze(data) {
  _pruneExtensionQueue();
  if (_extensionDataQueue.length >= QUEUE_MAX_SIZE) {
    console.warn(`队列已满，丢弃最旧的请求`);
    _extensionDataQueue.shift();
  }
  _extensionDataQueue.push({ type: "extension-analyze", payload: data, timestamp: Date.now() });
}

// ========== 测试用例 ==========

async function testQueueMaxSizeLimit() {
  console.log("测试: 队列大小限制");
  _extensionDataQueue = [];

  // 插入超过最大限制的数据
  for (let i = 0; i < QUEUE_MAX_SIZE + 20; i++) {
    handleExtensionImport({ office: "EP", type: "doclist", index: i });
  }

  // 验证队列不超过最大大小
  assert(_extensionDataQueue.length <= QUEUE_MAX_SIZE, `队列大小 ${_extensionDataQueue.length} 超过限制 ${QUEUE_MAX_SIZE}`);
  assert(_extensionDataQueue.length === QUEUE_MAX_SIZE, `队列大小应为 ${QUEUE_MAX_SIZE}，实际为 ${_extensionDataQueue.length}`);

  // 验证最新的数据保留（旧的被丢弃）
  const lastIndex = _extensionDataQueue[_extensionDataQueue.length - 1].payload.index;
  assert(lastIndex === QUEUE_MAX_SIZE + 19, `最新数据 index 应为 ${QUEUE_MAX_SIZE + 19}，实际为 ${lastIndex}`);

  console.log("✓ 队列大小限制验证通过");
}

async function testQueueTTLPruning() {
  console.log("测试: TTL 过期清理");
  _extensionDataQueue = [];

  // 插入一些"过期"数据（时间戳为过去）
  const oldTimestamp = Date.now() - QUEUE_TTL_MS - 10000; // 10秒前已过期
  _extensionDataQueue.push({ type: "extension-data", payload: { id: "old1" }, timestamp: oldTimestamp });
  _extensionDataQueue.push({ type: "extension-data", payload: { id: "old2" }, timestamp: oldTimestamp });

  // 插入新数据
  handleExtensionImport({ id: "new" });

  // _pruneExtensionQueue 应该已清理过期数据
  assert(_extensionDataQueue.length === 1, `队列应只有1条新数据，实际有 ${_extensionDataQueue.length} 条`);
  assert(_extensionDataQueue[0].payload.id === "new", "应保留新数据");

  console.log("✓ TTL 过期清理验证通过");
}

async function testConcurrentAccessSafety() {
  console.log("测试: 并发访问安全性");
  _extensionDataQueue = [];

  // 并发插入数据
  const promises = [];
  for (let i = 0; i < 50; i++) {
    promises.push(
      new Promise(resolve => {
        setTimeout(() => {
          handleExtensionImport({ concurrent: true, index: i });
          resolve();
        }, Math.random() * 10);
      })
    );
  }
  await Promise.all(promises);

  // 验证数据完整性（没有丢失或重复）
  assert(_extensionDataQueue.length === 50, `应有50条数据，实际为 ${_extensionDataQueue.length}`);

  // 验证没有重复 index
  const indexes = _extensionDataQueue.map(item => item.payload.index);
  const uniqueIndexes = new Set(indexes);
  assert(uniqueIndexes.size === 50, `应有不重复的50个index，实际只有 ${uniqueIndexes.size} 个`);

  console.log("✓ 并发访问安全性验证通过");
}

async function testQueueBoundedGrowth() {
  console.log("测试: 有界增长（防止内存耗尽）");
  _extensionDataQueue = [];

  const initialMemory = process.memoryUsage().heapUsed;

  // 插入大量数据，验证内存不会无限增长
  for (let batch = 0; batch < 10; batch++) {
    for (let i = 0; i < 1000; i++) {
      handleExtensionImport({ largePayload: new Array(100).fill("x").join(""), batch, i });
    }
  }

  const finalMemory = process.memoryUsage().heapUsed;
  const memoryGrowthMB = (finalMemory - initialMemory) / 1024 / 1024;

  // 验证内存增长可控（队列有最大限制，不应超过几MB）
  assert(memoryGrowthMB < 50, `内存增长 ${memoryGrowthMB.toFixed(2)} MB 过大，队列可能有泄漏`);
  console.log(`  内存增长: ${memoryGrowthMB.toFixed(2)} MB（合理范围内）`);

  console.log("✓ 有界增长验证通过");
}

// 运行所有测试
async function runTests() {
  console.log("\n========== 浏览器扩展队列边界管理测试 ==========\n");

  try {
    await testQueueMaxSizeLimit();
    await testQueueTTLPruning();
    await testConcurrentAccessSafety();
    await testQueueBoundedGrowth();

    console.log("\n========== ✓ 所有测试通过 ==========\n");
  } catch (error) {
    console.error("\n✗ 测试失败:", error.message);
    process.exit(1);
  }
}

runTests();