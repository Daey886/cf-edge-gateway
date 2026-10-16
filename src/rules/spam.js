/**
 * 垃圾邮件与营销过滤规则库 (分级防御体系)
 */
export const SpamRules = {
  // L1 级别：已知高危发件人 / 恶意域名黑名单（直接 550 拒信或彻底阻断）
  blockedSenders: [
    "spammer@badsite.com",
    "promo@marketing-junk.xyz",
    "noreply@fake-bank-alert.com",
  ],

  // L1 级别：极度危险的违规欺诈关键词（直接 550 拒信）
  highRiskKeywords: [
    "代开发票", "增值税发票", "普通发票", "低息贷款", "小额极速贷", "急用钱",
    "刷单返利", "兼职日结", "高额回报", "零风险套利",
    "澳门新葡京", "真人娱乐", "六合彩", "博彩平台", "棋牌赢钱",
    "viagra", "casino", "wire transfer", "crypto investment",
  ],

  // L2 级别：疑似营销推广、广告与常规订阅（自动降级分流，不打扰主收件箱）
  marketingKeywords: [
    "退订", "unsubscribe", "优惠券", "限时特惠", "专属福利", "年中大促",
    "双十一", "双11", "双12", "免费领取", "抽奖赢", "推荐您购买",
    "营销推广", "产品宣讲", "最新促销", "折扣码", "特价狂欢",
  ],
};
