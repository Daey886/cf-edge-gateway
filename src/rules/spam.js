/**
 * 垃圾拦截过滤规则库
 */
export const SpamRules = {
  // 1. 发件人/恶意域名黑名单 (小写匹配)
  blockedSenders: [
    "spammer@badsite.com",
    "promo@marketing-junk.xyz",
    "noreply@fake-bank-alert.com",
  ],

  // 2. 主题/内容敏感与垃圾关键词
  spamKeywords: [
    // 财务欺诈 / 违规金融
    "代开发票", "增值税发票", "普通发票", "低息贷款", "小额极速贷", "急用钱",
    "刷单返利", "兼职日结", "高额回报", "零风险套利",
    // 灰黑产 / 赌博
    "澳门新葡京", "真人娱乐", "六合彩", "博彩平台", "棋牌赢钱",
    // 钓鱼与欺诈
    "中奖通知", "恭喜中奖", "账户冻结通知", "密码重置申请（系统自动",
    // 英文垃圾邮件
    "viagra", "casino", "wire transfer", "crypto investment", "lottery winner",
    "beneficiary claim", "inheritance fund",
  ],

  // 3. 拦截策略配置
  // "reject": 向发件人返回 550 退信
  // "drop": 静默丢弃（不发退信，发件人无感知，直接不转发）
  defaultAction: "reject",
};
