/*!
 * PatentLens - 专利审查文档智能梳理工具
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 *
 * 本软件仅供内部使用，未经授权不得对外传播、复制或分发。
 * This software is for internal use only. Unauthorized distribution
 * or reproduction is strictly prohibited.
 *
 * @author Alfred Shi
 * @version 260728
 */
var PATENT_STATUS = {
  US: {
    codeMap: {
      "CTNF": { name: "非最终驳回 (Non-Final Rejection)", type: "office_action", stage: "审查中" },
      "CTFR": { name: "最终驳回 (Final Rejection)", type: "office_action", stage: "审查中" },
      "CTRS": { name: "限制性要求 (Restriction Requirement)", type: "office_action", stage: "审查中" },
      "CTAV": { name: "放弃意向通知 (Notice of Abandonment)", type: "notification", stage: "审查中" },
      "CTED": { name: "撤回回复 (Response after Final - Withdrawn)", type: "response", stage: "审查中" },
      "CTEQ": { name: "其他回复 (Other Response)", type: "response", stage: "审查中" },
      "CTMS": { name: "其他文件 (Miscellaneous)", type: "misc", stage: "审查中" },
      "NOA": { name: "授权通知 (Notice of Allowance)", type: "allowance", stage: "授权" },
      "AIPA": { name: "授权意向通知 (Notice of Allowance Data Verification Completed)", type: "allowance", stage: "授权" },
      "NFOA": { name: "首次非最终驳回 (Non-Final Office Action - First)", type: "office_action", stage: "审查中" },
      "FOA": { name: "首次最终驳回 (Final Office Action)", type: "office_action", stage: "审查中" },
      "OA": { name: "审查意见 (Office Action)", type: "office_action", stage: "审查中" },
      "RCEX": { name: "请求继续审查 (Request for Continued Examination)", type: "applicant_request", stage: "审查中" },
      "AMSB": { name: "修改提交 (Amendment Submitted)", type: "response", stage: "审查中" },
      "A": { name: "申请人修改 (Amendment)", type: "response", stage: "审查中" },
      "F": { name: "最终驳回 (Final Rejection)", type: "office_action", stage: "审查中" },
      "Q": { name: "非最终驳回 (Non-Final Rejection)", type: "office_action", stage: "审查中" },
      "R": { name: "限制性要求 (Restriction Requirement)", type: "office_action", stage: "审查中" },
      "M": { name: "其他文件 (Miscellaneous)", type: "misc", stage: "审查中" },
      "N": { name: "其他文件 (Miscellaneous)", type: "misc", stage: "审查中" },
      "P": { name: "初步修改/公开 (Preliminary Amendment / Publication)", type: "misc", stage: "审查中" },
      "B": { name: "维持驳回 (Ex Parte Quayle)", type: "office_action", stage: "审查中" },
      "EX.A": { name: "审查员答辩意见 (Examiner's Answer)", type: "office_action", stage: "复审" },
      "A...": { name: "非最终驳回后修改/复审请求 (Amendment/Request for Reconsideration-After Non-Final Rejection)", type: "response", stage: "审查中" },
      "A.NE": { name: "最终驳回后答复 (Response After Final Action)", type: "response", stage: "审查中" },
      "A.NE.AFCP": { name: "最终驳回后考虑计划请求 (After Final Consideration Program Request)", type: "response", stage: "审查中" },
      "A.NE.AFCP.D": { name: "最终驳回后考虑计划决定 (After Final Consideration Program Decision)", type: "notification", stage: "审查中" },
      "A.NA": { name: "授权通知后修改 (Amendment after Notice of Allowance)", type: "response", stage: "授权" },
      "REM": { name: "申请人意见陈述 (Applicant Arguments/Remarks Made in an Amendment)", type: "response", stage: "审查中" },
      "CLM": { name: "权利要求 (Claims)", type: "patent_doc", stage: "审查中" },
      "SPEC": { name: "说明书 (Specification)", type: "patent_doc", stage: "审查中" },
      "ABST": { name: "摘要 (Abstract)", type: "patent_doc", stage: "审查中" },
      "IDS": { name: "信息披露声明 (Information Disclosure Statement)", type: "citation", stage: "审查中" },
      "FOR": { name: "外国引用文献 (Foreign Reference)", type: "citation", stage: "审查中" },
      "892": { name: "审查员引用文献列表 (List of References Cited by Examiner)", type: "citation", stage: "审查中" },
      "1449": { name: "申请人引用且审查员考虑的文献列表 (List of References Cited by Applicant and Considered by Examiner)", type: "citation", stage: "审查中" },
      "SRNT": { name: "审查员检索策略和结果 (Examiner's Search Strategy and Results)", type: "citation", stage: "审查中" },
      "SRFW": { name: "检索信息 (Search Information including Classification, Databases and Other Search Related Notes)", type: "citation", stage: "审查中" },
      "FWCLM": { name: "权利要求索引 (Index of Claims)", type: "patent_doc", stage: "审查中" },
      "BIB": { name: "书目数据表 (Bibliographic Data Sheet)", type: "citation", stage: "审查中" },
      "EXIN": { name: "审查员面谈记录 (Examiner Interview Summary Record)", type: "notification", stage: "审查中" },
      "IIFW": { name: "授权信息 (Issue Information including Classification, Examiner, Name, Claim, Renumbering, etc.)", type: "allowance", stage: "授权" },
      "ISSUE.NTF": { name: "授权公告通知 (Issue Notification)", type: "allowance", stage: "授权" },
      "IFEE": { name: "授权费缴纳 (Issue Fee Payment)", type: "allowance", stage: "授权" },
      "WFEE": { name: "费用工作表 (Fee Worksheet)", type: "misc", stage: "审查中" },
      "N417": { name: "电子提交确认回执 (Electronic Filing System Acknowledgment Receipt)", type: "notification", stage: "审查中" },
      "N570": { name: "代理委托书沟通 (Communication - Re: Power of Attorney)", type: "notification", stage: "审查中" },
      "N572": { name: "代理委托书回复 (Response - Re: Informal Power of Attorney)", type: "notification", stage: "审查中" },
      "M327": { name: "申请人杂项通知 (Miscellaneous Communication to Applicant - No Action Count)", type: "notification", stage: "审查中" },
      "PA..": { name: "代理委托书 (Power of Attorney)", type: "misc", stage: "审查中" },
      "R3.73": { name: "受让人所有权证明 (Assignee Showing of Ownership per 37 CFR 3.73)", type: "misc", stage: "审查中" },
      "R46C.REQ": { name: "申请人更正请求 (Request under 37CFR 1.46(c) to Correct/Update/Change Applicant)", type: "applicant_request", stage: "审查中" },
      "TRAN.LET": { name: "传送信函 (Transmittal Letter)", type: "misc", stage: "审查中" },
      "APP.FILE.REC": { name: "申请受理回执 (Filing Receipt)", type: "notification", stage: "审查前" },
      "PET.PCT": { name: "PCT法律审查请愿 (Petition for Review by the PCT Legal Office)", type: "applicant_request", stage: "审查中" },
      "PET.OP.DEC": { name: "请愿决定 (Office of Petitions Decision)", type: "notification", stage: "审查中" },
      "PETDEC": { name: "请愿决定 (Petition Decision)", type: "notification", stage: "审查中" },
      "PET.DEC.TC": { name: "技术中心请愿决定 (Petition Decision Routed to Technology Center)", type: "notification", stage: "审查中" },
      "RFN.REQ": { name: "退费请求 (Refund Request)", type: "applicant_request", stage: "审查中" },
      "XT/": { name: "延期请求 (Extension of Time)", type: "applicant_request", stage: "审查中" },
      "136A": { name: "延期授权 (Authorization for Extension of Time)", type: "applicant_request", stage: "审查中" },
      "IMIS": { name: "内部杂项文件 (Miscellaneous Internal Document)", type: "misc", stage: "审查中" },
      "SCORE": { name: "补充内容占位页 (Supplemental Complex Repository for Examiners)", type: "misc", stage: "审查中" },
      "DRW.NONBW": { name: "非黑白线条图 (Drawings - Other than Black and White Line Drawings)", type: "patent_doc", stage: "审查中" },
      "SES.LOSS": { name: "小实体资格丧失通知 (Notification of Loss of Entitlement to Small Entity Status)", type: "notification", stage: "审查中" },
      "PA": { name: "初步修改 (Preliminary Amendment)", type: "response", stage: "审查前" },
      "WDR": { name: "审查前正式通知答复 (Applicant Response to Pre-Exam Formalities Notice)", type: "response", stage: "审查前" },
      "DRW": { name: "黑白线条图 (Drawings - Black and White Line Drawings)", type: "patent_doc", stage: "审查中" },
      "SEQ": { name: "序列表 (Sequence Listing)", type: "patent_doc", stage: "审查中" },
      "ABN": { name: "放弃 (Abandonment)", type: "notification", stage: "审查中" },
      "TRN": { name: "新申请传送 (Transmittal of New Application)", type: "misc", stage: "审查前" },
      "CFP": { name: "外国优先权认证副本 (Certified Copy of Foreign Priority Application)", type: "misc", stage: "审查前" },
      "NTC.PUB": { name: "公开通知 (Notice of Publication)", type: "notification", stage: "审查中" },
      "DO.EO.MISS": { name: "指定局/选定局缺失要求通知 (Notice of DO/EO Missing Requirements Mailed)", type: "notification", stage: "审查中" },
      "DO.EO.ACPT": { name: "指定局/选定局受理通知 (Notice of Designated Office/Elected Office Acceptance Mailed)", type: "notification", stage: "审查中" },
      "RES.ER": { name: "选举/限制答复 (Response to Election / Restriction Filed)", type: "response", stage: "审查中" },
      "EGRN": { name: "电子授权当日通知 (eGrant day-of Notification)", type: "allowance", stage: "授权" },
      "NTC.EGRN": { name: "电子授权当日通知 (eGrant day-of Notification)", type: "allowance", stage: "授权" },
      "EGRT": { name: "电子授权通知 (eGrant Notification)", type: "allowance", stage: "授权" },
      "ISS.NTF": { name: "授权公告通知 (Issue Notification)", type: "allowance", stage: "授权" },
      "PTO.FEE": { name: "专利局费用通知 (PTO Fee Notification)", type: "notification", stage: "授权" },
      "WELCOME.LET": { name: "USPTO局长欢迎信 (Welcome Letter from USPTO Director and Deputy Director)", type: "notification", stage: "审查前" },
      "PD.FILED.F": { name: "电子检索优先权文件 (Priority Documents electronically retrieved requiring USPTO confirmation)", type: "misc", stage: "审查前" },
      "N417.PYMT": { name: "电子提交缴费回执 (Electronic Filing System Payment Receipt)", type: "notification", stage: "审查中" },
      "OA.APPENDIX": { name: "审查意见附录 (Office Action Appendix)", type: "office_action", stage: "审查中" },
      "EGRANT.NTF": { name: "电子授权通知 (eGrant Notification)", type: "allowance", stage: "授权" },
      "ETCL": { name: "权利要求英文翻译 (English Translation of the Claims)", type: "patent_doc", stage: "审查中" },
      "DAFP": { name: "准予继续审查决定 (Decision to Allow Further Processing)", type: "notification", stage: "审查中" },
      "NRPD": { name: "新修订公开日期通知 (Notice of New or Revised Publication Date)", type: "notification", stage: "审查中" },
      "AFCP": { name: "最终驳回后修改或37CFR 1.312修改 (Amendment After Final or under 37CFR 1.312)", type: "response", stage: "审查中" },
      "BRAP": { name: "复审请求书 (Appeal Brief Filed)", type: "response", stage: "复审" },
      "EXBR": { name: "审查员复审答辩意见 (Examiner's Answer to Appeal Brief)", type: "office_action", stage: "复审" },
      "REBR": { name: "复审答复书 (Reply Brief Filed)", type: "response", stage: "复审" },
      "PABC": { name: "预复审会议请求 (Pre-Appeal Brief Conference Request)", type: "applicant_request", stage: "复审" },
      "PABC.D": { name: "预复审会议决定 (Pre-Brief Appeal Conference Decision)", type: "notification", stage: "复审" },
      "NOAP": { name: "上诉通知 (Notice of Appeal Filed)", type: "response", stage: "复审" },
      "RCFR": { name: "更正受理回执请求 (Request for Corrected Filing Receipt)", type: "applicant_request", stage: "审查前" },
      "ECOFC.NTF": { name: "电子更正证书当日通知 (eCofC day-of Notification)", type: "notification", stage: "授权" },
      "COFC.POST": { name: "更正证书-授权后往来函件 (Certificate of Correction - Post Issue Communication)", type: "notification", stage: "授权" },
      "COFC.SPE.RET": { name: "监督审查员答复-退回更正证书 (Supervisory Patent Examiner Response - Return for Certificate of Correction)", type: "notification", stage: "授权" },
      "COFC.PET.DEC": { name: "路由至更正证书的请愿决定 (Petition Decision routed to Certificate of Correction)", type: "notification", stage: "授权" },
      "COFC.REQ": { name: "更正证书请求 (Request for Certificate of Correction)", type: "applicant_request", stage: "授权" },
      "PTA.PET": { name: "专利期限调整请愿 (Patent Term Adjustment Petition)", type: "applicant_request", stage: "授权" },
      "MFEE.ADDR": { name: "年费地址变更 (Maintenance Fee Address Change)", type: "applicant_request", stage: "授权" },
      "IDS.FEE.ASSN": { name: "关于信息披露声明(IDS)超页费声明(SB/08C) (Assertion regarding IDS Size Fee)", type: "citation", stage: "审查中" },
      "PET.OP.REV": { name: "请愿处审查请愿 (Petition for review by the Office of Petitions)", type: "applicant_request", stage: "审查中" },
      "RFP": { name: "继续审查请求 (Request for Further Processing)", type: "applicant_request", stage: "审查中" },
      "SPEC.AMD.NE": { name: "说明书修改未录入 (Specification-Amendment Not Entered)", type: "notification", stage: "审查中" },
    },
    typeNames: {
      "office_action": "审查意见",
      "response": "申请人答复",
      "patent_doc": "专利文件",
      "citation": "审查员引用与IDS",
      "allowance": "授权通知",
      "applicant_request": "申请人其他请求",
      "notification": "通知",
      "misc": "其他文件",
    },
    descMap: {
      "preliminary amendment": "初步修改 (Preliminary Amendment)",
      "welcome letter": "USPTO局长欢迎信 (Welcome Letter from USPTO Commissioner)",
      "transmittal of new application": "新申请传送 (Transmittal of New Application)",
      "certified copy of foreign priority": "外国优先权认证副本 (Certified Copy of Foreign Priority Application)",
      "other reference": "其他引用文献 (Other reference-Patent/Application/Search Documents)",
      "post allowance communication": "授权后往来函件 (Post Allowance Communication - Incoming)",
      "claims worksheet": "权利要求工作表 (Claims Worksheet (PTO-2022))",
      "pct/ro/101": "PCT国际申请请求表 (PCT/RO/101 - Request form for new International Application)",
      "request form for new international application": "PCT国际申请请求表 (PCT/RO/101 - Request form for new International Application)",
      "notice of designated office": "指定局/选定局受理通知 (Notice of Designated Office/Elected Office Acceptance Mailed)",
      "documents submitted with 371": "371国家阶段申请提交文件 (Documents submitted with 371 (National Stage) Applications)",
      "national stage": "国家阶段申请文件 (Documents submitted with 371 (National Stage) Applications)",
      "english translation of the claims": "权利要求英文翻译 (English Translation of the Claims)",
      "decision to allow further processing": "准予继续审查决定 (Decision to Allow Further Processing)",
      "notice of new or revised publication date": "新修订公开日期通知 (Notice of New or Revised Publication Date)",
      "amendment after final or under 37cfr 1.312": "最终驳回后修改或37CFR 1.312修改 (Amendment After Final or under 37CFR 1.312)",
      "applicant response to pre-exam formalities notice": "审查前形式审查通知答复 (Applicant Response to Pre-Exam Formalities Notice)",
      "appeal brief filed": "复审请求书 (Appeal Brief Filed)",
      "examiner's answer to appeal brief": "审查员复审答辩意见 (Examiner's Answer to Appeal Brief)",
      "reply brief filed": "复审答复书 (Reply Brief Filed)",
      "pre-appeal brief conference request": "预复审会议请求 (Pre-Appeal Brief Conference Request)",
      "notice of appeal filed": "上诉通知 (Notice of Appeal Filed)",
      "pre-brief appeal conference decision": "预复审会议决定 (Pre-Brief Appeal Conference Decision)",
      "request for corrected filing receipt": "更正受理回执请求 (Request for Corrected Filing Receipt)",
      "ecofc day-of notification": "电子更正证书当日通知 (eCofC day-of Notification)",
      "certificate of correction - post issue communication": "更正证书-授权后往来函件 (Certificate of Correction - Post Issue Communication)",
      "supervisory patent examiner response - return for certificate of correction": "监督审查员答复-退回更正证书 (Supervisory Patent Examiner Response - Return for Certificate of Correction)",
      "petition decision routed to certificate of correction": "路由至更正证书的请愿决定 (Petition Decision routed to Certificate of Correction)",
      "request for certificate of correction": "更正证书请求 (Request for Certificate of Correction)",
      "patent term adjustment petition": "专利期限调整请愿 (Patent Term Adjustment Petition)",
      "maintenance fee address change": "年费地址变更 (Maintenance Fee Address Change)",
      "assertion regarding information disclosure statement": "关于信息披露声明(IDS)超页费声明 (Assertion regarding IDS Size Fee)",
      "petition for review by the office of petitions": "请愿处审查请愿 (Petition for review by the Office of Petitions)",
      "decision to allow further processing": "准予继续审查决定 (Decision to Allow Further Processing)",
      "english translation of the claims": "权利要求英文翻译 (English Translation of the Claims)",
      "request for further processing": "继续审查请求 (Request for Further Processing)",
      "miscellaneous incoming letter": "杂项来函 (Miscellaneous Incoming Letter)",
      "incoming letter": "来函 (Incoming Letter)",
      "response to election / restriction filed": "选举/限制要求答复 (Response to Election / Restriction Filed)",
      "change of address via patent application information retrieval": "通过PAIR变更地址 (Change of Address via Patent Application Information Retrieval (PAIR))",
      "applicant initiated interview summary": "申请人发起的面谈摘要 (Applicant Initiated Interview Summary (PTOL-413))",
      "notice to file missing parts": "补正缺失部分通知 (Notice to File Missing Parts)",
      "authorization or rescission of authorization to access application by digital access service": "DAS/PDX访问授权或撤销 (Authorization or Rescission of Authorization to Access Application by Digital Access Service /Priority Document Exchange Office)",
      "change of address": "地址变更 (Change of Address)",
      "specification-amendment not entered": "说明书修改未录入 (Specification-Amendment Not Entered)",
      "specification amendment not entered": "说明书修改未录入 (Specification-Amendment Not Entered)",
    },
    stageNames: {
      "审查前": "审查前",
      "审查中": "审查中",
      "授权": "已授权",
      "复审": "复审阶段",
      "完成": "已结案",
    },
    abstract: {
      "office_action": "审查员发出审查意见",
      "response": "申请人提交答复/修改",
      "patent_doc": "专利基础文件",
      "citation": "审查员引用文献/IDS/检索",
      "allowance": "审查员同意授权",
      "applicant_request": "申请人提交其他请求",
      "notification": "官方通知",
      "misc": "其他往来文件",
    },
    aiAnalysisTypes: ["office_action", "response", "allowance"],
  },
  CN: {
    codeMap: {
      "100001-CN": { name: "权利要求书", type: "patent_doc", stage: "申请" },
      "100002-CN": { name: "说明书", type: "patent_doc", stage: "申请" },
      "100003-CN": { name: "说明书附图", type: "patent_doc", stage: "申请" },
      "100004-CN": { name: "说明书摘要", type: "patent_doc", stage: "申请" },
      "200103-CN": { name: "审查意见通知书", type: "office_action", stage: "审查中" },
      "200104-CN": { name: "意见陈述书", type: "response", stage: "审查中" },
      "200105-CN": { name: "补正书", type: "response", stage: "审查中" },
      "200106-CN": { name: "修改替换页", type: "response", stage: "审查中" },
      "200201-CN": { name: "授权通知书", type: "allowance", stage: "授权" },
      "200202-CN": { name: "办理登记手续通知书", type: "notification", stage: "授权" },
      "0-CN": { name: "检索报告", type: "citation", stage: "审查中" },
      "100005-CN": { name: "摘要附图", type: "patent_doc", stage: "申请" },
      "200107-CN": { name: "复审请求书", type: "response", stage: "复审" },
      "200108-CN": { name: "无效宣告请求书", type: "response", stage: "复审" },
    },
    descMap: {
      "right-claiming document": "权利要求书",
      "instructions": "说明书",
      "first search": "首次检索报告",
    },
    typeNames: {
      "office_action": "审查意见", "response": "申请人答复",
      "patent_doc": "专利文件", "citation": "审查员引用与IDS",
      "allowance": "授权通知", "applicant_request": "申请人其他请求",
      "notification": "通知", "misc": "其他文件"
    },
    stageNames: {
      "申请": "申请", "审查中": "审查中", "授权": "授权", "复审": "复审", "未知": "未知"
    },
    abstract: "中国专利审查",
    aiAnalysisTypes: ["office_action", "response", "allowance"],
  },
  EP: {
    codeMap: {
      // === 审查意见 (Office Actions) ===
      "1703": { name: "欧洲检索意见 (European Search Opinion)", type: "office_action", stage: "审查中" },
      "2001": { name: "审查部审查意见 (Communication from Examining Division)", type: "office_action", stage: "审查中" },
      "2906": { name: "审查意见附件 (Annex to the Communication)", type: "office_action", stage: "审查中" },
      "2906I": { name: "拟授权通知附件 (Annex to Intention to Grant)", type: "office_action", stage: "授权" },
      "2049A": { name: "电话/面谈咨询 (Consultation by Telephone/In Person)", type: "office_action", stage: "审查中" },
      "2036": { name: "电话/面谈结果 (Result of Consultation)", type: "office_action", stage: "审查中" },
      "ISA237-1": { name: "国际检索书面意见-封面 (Written Opinion of ISA - Cover)", type: "office_action", stage: "审查中" },
      "ISA237-2": { name: "国际检索书面意见-正文 (Written Opinion of ISA - Body)", type: "office_action", stage: "审查中" },
      "ISA237-3": { name: "国际检索书面意见-补充 (Written Opinion of ISA - Supplemental)", type: "office_action", stage: "审查中" },

      // === 申请人答复/请求 (Responses & Requests merged) ===
      "ABEX": { name: "审查前修改 (Amendments Before Examination)", type: "response", stage: "审查中" },
      "CLMSABEX": { name: "检索后修改权利要求 (Amended Claims After Search Report)", type: "response", stage: "审查中" },
      "DESCABEX": { name: "检索后修改说明书 (Amended Description After Search Report)", type: "response", stage: "审查中" },
      "EXRE3": { name: "对审查意见的答复 (Reply to Examining Division)", type: "response", stage: "审查中" },
      "EXRE92": { name: "审查意见答复延期请求 (Request for Extension of Time Limit)", type: "applicant_request", stage: "审查中" },
      "FORAREPLY": { name: "补正答复 (Reply to Invitation to Remedy Deficiencies)", type: "response", stage: "审查中" },
      "CLMS-HWA": { name: "标注修改的权利要求 (Amended Claims with Annotations)", type: "response", stage: "审查中" },
      "DESC-HWA": { name: "标注修改的说明书 (Amended Description with Annotations)", type: "response", stage: "审查中" },
      "IGRA7": { name: "提交权利要求翻译 (Filing of Translations of Claims)", type: "applicant_request", stage: "授权" },
      "RO-DESC-26": { name: "替换页-说明书 (Substitute Sheet - Description)", type: "response", stage: "审查中" },

      // === 授权通知 (Allowance) ===
      "2004": { name: "拟授权通知 (Intention to Grant)", type: "allowance", stage: "授权" },
      "2006A": { name: "授权决定 (Decision to Grant)", type: "allowance", stage: "授权" },
      "2035-4": { name: "拟授权签名页 (Intention to Grant - Signatures)", type: "allowance", stage: "授权" },
      "DREX": { name: "拟授权文本 (Text Intended for Grant)", type: "allowance", stage: "授权" },
      "EDREX": { name: "拟授权文本-审批版 (Text for Grant - Approval Version)", type: "allowance", stage: "授权" },
      "EDREXFINAL": { name: "拟授权文本-清稿 (Text for Grant - Clean Copy)", type: "allowance", stage: "授权" },
      "2056": { name: "专利申请书目数据 (Bibliographic Data)", type: "citation", stage: "授权" },

      // === 通知 (Notifications) ===
      "1001-6E": { name: "电子提交受理回执 (Acknowledgement of Receipt)", type: "notification", stage: "审查前" },
      "1048": { name: "发明人通知 (Communication to Designated Inventor)", type: "notification", stage: "审查前" },
      "1045": { name: "发明人指定缺陷 (Deficiency in Designation of Inventor)", type: "notification", stage: "审查前" },
      "1117": { name: "补正发明人地址 (Invitation to Indicate Inventor Address)", type: "notification", stage: "审查前" },
      "1128": { name: "序列表缺陷 (Deficiencies in Sequence Listing)", type: "notification", stage: "审查前" },
      "1133": { name: "公开通知 (Notification of Forthcoming Publication)", type: "notification", stage: "审查中" },
      "1219": { name: "书目数据公开通知 (Notification on Forthcoming Publication)", type: "notification", stage: "审查中" },
      "1081": { name: "审查费/指定费缴费提醒 (Reminder for Payment of Exam/Designation Fee)", type: "notification", stage: "审查中" },
      "1082": { name: "确认维持申请邀请 (Invitation to Confirm Maintenance)", type: "notification", stage: "审查中" },
      "1224": { name: "声明维持申请邀请 (Invitation to Declare Maintenance)", type: "notification", stage: "审查中" },
      "1225": { name: "年费缴纳通知 (Notice for Payment of Renewal Fee)", type: "notification", stage: "审查中" },
      "1226": { name: "权利要求修改/费用通知 (Communication re Claims Amendment/Fees)", type: "notification", stage: "审查中" },
      "1195": { name: "优先权文件收据 (Confirmation of Priority Document Receipt)", type: "notification", stage: "审查前" },
      "1507": { name: "检索报告传送通知 (Communication re Transmission of Search Report)", type: "notification", stage: "审查中" },
      "2047": { name: "专利证书传送 (Transmission of Patent Certificate)", type: "notification", stage: "授权" },
      "2057": { name: "异议期届满通知 (Expiry of Opposition Period)", type: "notification", stage: "授权" },
      "2907": { name: "退费通知 (Refund of Fees)", type: "notification", stage: "审查中" },
      "2909": { name: "修改基础说明邀请 (Invitation to Indicate Basis for Amendments)", type: "notification", stage: "审查中" },
      "2911": { name: "简短通知 (Brief Communication to Applicant)", type: "notification", stage: "审查中" },
      "2913": { name: "提交检索结果副本邀请 (Invitation to File Search Results Copy)", type: "notification", stage: "审查中" },
      "2944A": { name: "延期批准 (Grant of Extension of Time Limit)", type: "notification", stage: "审查中" },
      "1205N": { name: "申请视为撤回 (Application Deemed Withdrawn)", type: "notification", stage: "审查中" },
      "IB306": { name: "变更记录通知 (Notification of Recording of Change)", type: "notification", stage: "审查中" },
      "2548": { name: "代理人变更通知 (Communication of Amended Representative Entries)", type: "notification", stage: "审查中" },
      "2548S": { name: "代理人变更通知 (Communication of Amended Representative Entries)", type: "notification", stage: "审查中" },
      "RO106": { name: "国际申请补正邀请 (Invitation to Correct Defects)", type: "notification", stage: "审查前" },
      "RO105": { name: "国际申请号通知 (Notification of International Application Number)", type: "notification", stage: "审查前" },

      // === 申请人其他请求 (Applicant Requests) ===
      "1001P": { name: "欧洲专利授权请求 (Request for Grant of European Patent)", type: "applicant_request", stage: "审查前" },
      "1200P": { name: "进入欧洲阶段请求 (Request for Entry into European Phase)", type: "applicant_request", stage: "审查前" },
      "RO101E": { name: "国际申请电子请求 (Electronic Request for International Application)", type: "applicant_request", stage: "审查前" },

      // === 专利文件 (Patent Documents) ===
      "DESC": { name: "说明书 (Description)", type: "patent_doc", stage: "审查前" },
      "CLMS": { name: "权利要求书 (Claims)", type: "patent_doc", stage: "审查前" },
      "ABST": { name: "摘要 (Abstract)", type: "patent_doc", stage: "审查前" },
      "DRAW": { name: "附图 (Drawings)", type: "patent_doc", stage: "审查前" },
      "ABSTMOD": { name: "修改摘要 (Modified Abstract)", type: "patent_doc", stage: "审查中" },
      "CLMSTRAN-DE": { name: "德文权利要求翻译 (German Translation of Claims)", type: "patent_doc", stage: "授权" },
      "CLMSTRAN-FR": { name: "法文权利要求翻译 (French Translation of Claims)", type: "patent_doc", stage: "授权" },
      "SEQL": { name: "序列表 (Sequence Listing)", type: "patent_doc", stage: "审查前" },
      "SEQLCON": { name: "转换序列表 (Converted Sequence Listing)", type: "patent_doc", stage: "审查前" },

      // === 审查员引用 (Citations) ===
      "1503": { name: "欧洲检索报告 (European Search Report)", type: "citation", stage: "审查中" },
      "1503SS": { name: "补充欧洲检索报告 (Supplementary European Search Report)", type: "citation", stage: "审查中" },
      "SRCHSTRAEP": { name: "检索策略信息 (Information on Search Strategy)", type: "citation", stage: "审查中" },
      "CDOCNPL": { name: "非专利引用文献 (Non-Patent Literature Cited)", type: "citation", stage: "审查中" },
      "ISA210-2": { name: "国际检索引用文献 (ISR Cited Documents)", type: "citation", stage: "审查中" },
      "ISR": { name: "国际检索报告副本 (Copy of International Search Report)", type: "citation", stage: "审查前" },
      "PRSR": { name: "优先权检索结果 (Priority Search Results)", type: "citation", stage: "审查前" },
      "PRSR-X": { name: "EPO优先权检索结果副本 (Priority Search Results Copy from EPO)", type: "citation", stage: "审查前" },

      // === 其他文件 (Miscellaneous) ===
      "1002": { name: "发明人指定 (Designation of Inventor)", type: "misc", stage: "审查前" },
      "PRIO": { name: "优先权信函 (Letter Concerning Priority)", type: "misc", stage: "审查前" },
      "PRIODOC": { name: "优先权文件 (Priority Document)", type: "misc", stage: "审查前" },
      "PRIODOC-X": { name: "电子优先权文件 (Priority Document - Electronic)", type: "misc", stage: "审查前" },
      "PRSR-SRCH": { name: "优先权检索结果提交函 (Cover Letter for Priority Search Results)", type: "misc", stage: "审查前" },
      "PRSR-NON": { name: "优先权检索结果不可用声明 (Statement of Non-availability)", type: "misc", stage: "审查前" },
      "1038": { name: "后续提交文件附函 (Letter Accompanying Subsequently Filed Items)", type: "misc", stage: "审查中" },
      "RECEIPT-OLF": { name: "电子回执 (Electronic Receipt)", type: "misc", stage: "审查中" },
      "SRCH-START": { name: "检索开始 (Search Started)", type: "misc", stage: "审查中" },
      "EX-START": { name: "审查开始 (Examination Started)", type: "misc", stage: "审查中" },
      "INCANNEX": { name: "附件 (Annex)", type: "misc", stage: "审查中" },
      "CDAPPR-CHOR": { name: "变更代理人提交 (Submission re Change of Representative)", type: "misc", stage: "审查中" },
      "CD-FREP": { name: "代理委托提交 (Submission Concerning Representation)", type: "misc", stage: "审查中" },
      "RETURNED": { name: "未送达信函 (Letter Not Notified)", type: "misc", stage: "审查中" },
      "FEES-RO": { name: "费用文件 (Document Concerning Fees)", type: "misc", stage: "审查中" },
      "PAYREJ": { name: "缴费被拒 (Payment Submission Rejected)", type: "misc", stage: "审查中" },
      "INVT": { name: "发明人信函 (Letter Concerning Inventor)", type: "misc", stage: "审查中" },
      "A1PAMPHLET": { name: "公开国际申请 (Published International Application - A1)", type: "misc", stage: "审查前" },
      "IPRP": { name: "国际初步审查报告 (International Preliminary Report on Patentability)", type: "misc", stage: "审查前" },
      "RO-LETT": { name: "PCT受理局来函 (Incoming Letter - PCT RO)", type: "misc", stage: "审查前" },
      "1201-1": { name: "进入欧洲阶段信息 (Information on Entry into European Phase)", type: "misc", stage: "审查前" },
      "SRCH": { name: "检索事务信函 (Letter Concerning Search Matters)", type: "misc", stage: "审查中" },
    },
    descMap: {
      "european search opinion": "欧洲检索意见",
      "communication from the examining division": "审查部审查意见",
      "annex to the communication": "审查意见附件",
      "intention to grant": "拟授权通知",
      "decision to grant": "授权决定",
      "text intended for grant": "拟授权文本",
      "reply to communication from the examining division": "对审查意见的答复",
      "amendments received before examination": "审查前修改",
      "amended claims filed after receipt of": "检索后修改权利要求",
      "amended description filed after receipt of": "检索后修改说明书",
      "amended claims with annotations": "标注修改的权利要求",
      "amended description with annotations": "标注修改的说明书",
      "request for grant of a european patent": "欧洲专利授权请求",
      "european search report": "欧洲检索报告",
      "supplementary european search report": "补充欧洲检索报告",
      "notification of forthcoming publication": "公开通知",
      "communication regarding the transmission of the european search report": "检索报告传送通知",
      "reminder period for payment of examination fee": "审查费缴费提醒",
      "invitation to confirm maintenance": "确认维持申请邀请",
      "bibliographic data": "书目数据",
      "filing of the translations of the claims": "提交权利要求翻译",
      "german translation of the claims": "德文权利要求翻译",
      "french translation of claims": "法文权利要求翻译",
      "letter accompanying subsequently filed items": "后续提交文件附函",
      "designation of inventor": "发明人指定",
      "priority document": "优先权文件",
      "letter concerning the priority": "优先权信函",
      "priority search results": "优先权检索结果",
      "communication to designated inventor": "发明人通知",
      "acknowledgement of receipt": "受理回执",
      "transmission of the certificate": "专利证书传送",
      "expiry of opposition period": "异议期届满通知",
      "information on entry into european phase": "进入欧洲阶段信息",
      "application deemed to be withdrawn": "申请视为撤回",
      "consultation by telephone": "电话/面谈咨询",
      "result of consultation": "电话/面谈结果",
      "refund of fees": "退费通知",
      "grant of extension of time limit": "延期批准",
      "request for extension of time limit": "延期请求",
      "invitation to indicate the basis for amendments": "修改基础说明邀请",
      "brief communication to applicant": "简短通知",
      "information on search strategy": "检索策略信息",
      "non-patent literature cited": "非专利引用文献",
      "submission concerning change of applicant": "变更申请人提交",
      "submission concerning representation": "代理委托提交",
      "communication of amended entries concerning the representative": "代理人变更通知",
      "deficiency in designation of inventor": "发明人指定缺陷",
      "deficiencies in sequence listing": "序列表缺陷",
      "modified abstract": "修改摘要",
      "examination started": "审查开始",
      "search started": "检索开始",
      "letter relating to the revocation of the automatic debiting procedure": "关于撤销自动扣款程序的信函",
      "communication concerning the withdrawal of the automatic debiting procedure": "关于撤销自动扣款程序的通知",
      "miscellaneous incoming letter": "杂项来函 (Miscellaneous Incoming Letter)",
      "incoming letter": "来函 (Incoming Letter)",
    },
    typeNames: {
      "office_action": "审查意见", "response": "申请人答复",
      "patent_doc": "专利文件", "citation": "审查员引用与IDS",
      "allowance": "授权通知", "applicant_request": "申请人其他请求",
      "notification": "通知", "misc": "其他文件"
    },
    stageNames: {
      "审查前": "审查前", "审查中": "审查中", "授权": "已授权", "复审": "复审阶段", "未知": "未知"
    },
    abstract: "欧洲专利审查",
    aiAnalysisTypes: ["office_action", "response", "allowance"],
  },
  DE: {
    codeMap: {},
    descMap: {
      "beschreibung": "说明书",
      "ansprüche": "权利要求书",
      "zusammenfassung": "摘要",
      "zeichnung": "附图",
      "anschreiben": " cover letter",
      "antrag: erteilung eines patents": "专利授权申请",
      "erfinderbenennung": "发明人声明",
      "empfangsbestätigung für eine patentanmeldung": "专利申请受理通知书",
      "bibliographiemitteilung": "书目信息通知",
      "bibliografie-mitteilung": "书目信息通知",
      "prüfungsantrag": "实质审查请求",
      "prüfungsbescheid": "审查意见通知书",
      "bescheid": "通知书",
      "erwidung": "答复",
      "beschränkung": "修改/限制",
      "erteilung": "授权",
      "erteilungsbescheid": "授权通知书",
      "einspruch": "异议",
      "beschwerde": "申诉",
      "recherche": "检索报告",
      "offenlegungsschrift": "公开说明书",
      "patentschrift": "专利说明书",
      "teilung": "分案",
      "schutzbereich": "保护范围",
    },
    typeNames: {
      "office_action": "审查意见", "response": "申请人答复",
      "patent_doc": "专利文件", "citation": "审查员引用与IDS",
      "allowance": "授权通知", "applicant_request": "申请人其他请求",
      "notification": "通知", "misc": "其他文件"
    },
    stageNames: {
      "申请": "申请", "审查中": "审查中", "授权": "授权", "复审": "复审", "未知": "未知"
    },
    abstract: "德国专利审查",
    aiAnalysisTypes: ["office_action", "response", "allowance"],
  },
  JP: {
    codeMap: {
      "A131": { name: "驳回理由通知书", type: "office_action", stage: "审查中" },
      "A131-JP": { name: "驳回理由通知书（原文）", type: "office_action", stage: "审查中" },
      "A53": { name: "意见书", type: "response", stage: "审查中" },
      "A53-JP": { name: "意见书（原文）", type: "response", stage: "审查中" },
      "A523": { name: "补正书", type: "response", stage: "审查中" },
      "A523-JP": { name: "补正书（原文）", type: "response", stage: "审查中" },
      "A621": { name: "审查请求书", type: "applicant_request", stage: "申请" },
      "A621-JP": { name: "审查请求书（原文）", type: "applicant_request", stage: "申请" },
      "A63": { name: "申请文件", type: "patent_doc", stage: "申请" },
      "A63-JP": { name: "申请文件（原文）", type: "patent_doc", stage: "申请" },
      "A01": { name: "授权决定", type: "allowance", stage: "授权" },
      "A01-JP": { name: "授权决定（原文）", type: "allowance", stage: "授权" },
      "A971007": { name: "检索报告", type: "citation", stage: "审查中" },
      "A971007-JP": { name: "检索报告（原文）", type: "citation", stage: "审查中" },
    },
    descMap: {
      "notice of reasons for refusal": "驳回理由通知书",
      "written opinion": "意见书",
      "written amendment": "补正书",
      "request for examination": "审查请求书",
      "decision to grant a patent": "授权决定",
      "description": "说明书",
      "claims": "权利要求书",
      "drawings": "附图",
      "abstract": "摘要",
      "request for a patent": "专利申请",
      "search report": "检索报告",
    },
    typeNames: {
      "office_action": "审查意见", "response": "申请人答复",
      "patent_doc": "专利文件", "citation": "审查员引用与IDS",
      "allowance": "授权通知", "applicant_request": "申请人其他请求",
      "notification": "通知", "misc": "其他文件"
    },
    stageNames: {
      "申请": "申请", "审查中": "审查中", "授权": "授权", "复审": "复审", "未知": "未知"
    },
    abstract: "日本专利审查",
    aiAnalysisTypes: ["office_action", "response", "allowance"],
  },
};

function classifyDocCode(code, desc) {
  if (!code && !desc) return "notification";
  const codeUpper = (code || "").toUpperCase();
  const descLower = (desc || "").toLowerCase();
  const text = (codeUpper + " " + descLower).toLowerCase();

  // === Patent documents (专利文件) - check first ===
  // Claims, specification, abstract, drawings, sequence listing
  if (/\bclaims?\b/.test(text) && !/cited/.test(text)) return "patent_doc";
  if (/claim\s*(worksheet|index|translation)/i.test(text)) return "patent_doc";
  if (/specification/.test(text) && !/notice|notification|communication|not entered|amendment not/.test(text)) return "patent_doc";
  if (/\bdescription\b/.test(text) && !/notice|notification|communication|amended/i.test(text)) return "patent_doc";
  if (/\babstract\b/.test(text)) return "patent_doc";
  if (/drawings?\s*(-|—)\s*other than black and white/i.test(text)) return "patent_doc";
  if (/black and white line drawings?/.test(text)) return "patent_doc";
  if (/drawings?/.test(text) && /description|claims|abstract|figures/i.test(text)) return "patent_doc";
  if (/zeichnung/.test(descLower)) return "patent_doc";
  if (/beschreibung/.test(descLower)) return "patent_doc";
  if (/ansprüche/.test(descLower)) return "patent_doc";
  if (/zusammenfassung/.test(descLower)) return "patent_doc";
  if (/right.?claiming document/.test(text)) return "patent_doc";
  if (/sequence listing/.test(text)) return "patent_doc";
  if (/english translation of the claims/.test(text)) return "patent_doc";
  if (/german translation of claims|french translation of claims/i.test(text)) return "patent_doc";
  if (/instructions/.test(descLower) && !/notice|notification|communication/i.test(text)) return "patent_doc";
  if (/^CLMS?$|^CLM$|^SPEC$|^ABST$|^DRW$|^DRAW$|^DESC$|^ETCL$|^SEQ$|^SEQL$|^DRW\.NONBW$|^FWCLM$|^CLMSTRAN/.test(codeUpper)) return "patent_doc";
  if (/说明书|权利要求|摘要|附图/.test(text)) return "patent_doc";

  // === Citations (审查员引用) - search reports, cited references, search strategy, bibliographic ===
  if (/search report|supplementary.*search report|priority search results|isr cited documents/i.test(text)) return "citation";
  if (/list of references cited|cited by (examiner|applicant)|foreign reference|non-patent literature cited/i.test(text)) return "citation";
  if (/search strategy|information on search strategy/i.test(text)) return "citation";
  if (/search information.*classification|search information.*databases/i.test(text)) return "citation";
  if (/bibliographic data|bibliograph/i.test(text)) return "citation";
  if (/recherche/.test(descLower)) return "citation";
  if (/information disclosure statement|\bids\b/i.test(text)) return "citation";
  if (/^892$|^1449$|^SRNT$|^SRFW$|^BIB$|^FOR$|^1503$|^1503SS$|^SRCHSTRAEP$|^CDOCNPL$|^ISA210|^PRSR$|^PRSR-X$|^ISR$|^IDS$|^IDS\.FEE\.ASSN$/.test(codeUpper)) return "citation";

  // === Office Actions (审查意见) ===
  if (/european search opinion/.test(descLower)) return "office_action";
  if (/communication from the examining division/.test(descLower)) return "office_action";
  if (/annex to the communication/.test(descLower)) return "office_action";
  if (/written opinion of the isa/.test(descLower)) return "office_action";
  if (/consultation by telephone|consultation.*in person/.test(descLower)) return "office_action";
  if (/result of consultation/.test(descLower)) return "office_action";
  if (/notice of examination opinions|examination opinion/.test(descLower)) return "office_action";
  if (/prüfungsbescheid/.test(descLower)) return "office_action";
  if (/notice of reasons for refusal/.test(descLower)) return "office_action";
  if (/restriction|election of species/.test(text)) return "office_action";
  if (/final rejection/.test(text)) return "office_action";
  if (/non.?final rejection/.test(text)) return "office_action";
  if (/office action/.test(text)) return "office_action";
  if (/rejection/.test(text)) return "office_action";
  if (/appeal|examiner's answer/.test(text)) return "office_action";
  if (/^CTNF$|^CTFR$|^CTRS$|^NFOA$|^FOA$|^OA$|^F$|^Q$|^R$|^B$|^EX\.A$|^EXBR$/.test(codeUpper)) return "office_action";
  if (/^1703$|^2001$|^2906$|^2049A$|^2036$|^ISA237/.test(codeUpper)) return "office_action";
  if (/^200103-CN$|^A131/.test(codeUpper)) return "office_action";
  if (/审查意见|驳回理由|审查部审查/.test(text)) return "office_action";

  // === Allowance (授权通知) ===
  if (/intention to grant/.test(descLower)) return "allowance";
  if (/decision to grant/.test(descLower)) return "allowance";
  if (/text intended for grant/.test(descLower)) return "allowance";
  if (/notice of grant|grant notification|authorization notice/.test(descLower)) return "allowance";
  if (/notice of allowance/.test(text)) return "allowance";
  if (/egrant|e-grant/.test(text)) return "allowance";
  if (/erteilungsbescheid/.test(descLower)) return "allowance";
  if (/erteilung/.test(descLower) && !/antrag/.test(descLower)) return "allowance";
  if (/decision to grant a patent/.test(descLower)) return "allowance";
  if (/issue information.*classification|issue notification/i.test(text)) return "allowance";
  if (/^NOA$|^AIPA$|^IIFW$|^ISSUE|^EGRN$|^NTC\.EGRN$|^EGRT$|^EGRANT|^ISS\.NTF$|^2004$|^2006A$|^2035-4$|^DREX$|^EDREX/.test(codeUpper)) return "allowance";
  if (/^200201-CN$|^A01/.test(codeUpper)) return "allowance";
  if (/授权|allowance/.test(text)) return "allowance";

  // === Applicant Requests (申请人其他请求) - procedural/administrative requests, NOT responses to OA ===
  if (/filing of the translations of the claims/.test(descLower)) return "applicant_request";
  if (/request for grant of a european patent/.test(descLower)) return "applicant_request";
  if (/request for entry into the european phase|entry into european phase/.test(descLower)) return "applicant_request";
  if (/electronic request for international application/.test(descLower)) return "applicant_request";
  if (/request for extension of time limit/.test(descLower)) return "applicant_request";
  if (/request for continued examination/.test(text)) return "applicant_request";
  if (/request for further processing/.test(text)) return "applicant_request";
  if (/request for certificate of correction/.test(text)) return "applicant_request";
  if (/patent term adjustment petition/.test(text)) return "applicant_request";
  if (/maintenance fee address change/.test(text)) return "applicant_request";
  if (/petition for review/.test(text)) return "applicant_request";
  if (/pre-appeal brief conference request/.test(text)) return "applicant_request";
  if (/request for corrected filing receipt/.test(text)) return "applicant_request";
  if (/request for examination/.test(descLower)) return "applicant_request";
  if (/extension of time/.test(text) && /request|authorization/.test(text)) return "applicant_request";
  if (/refund request/.test(text)) return "applicant_request";
  if (/request under 37cfr/.test(text)) return "applicant_request";
  if (/^RCEX$|^R46C\.REQ$|^RFN\.REQ$|^XT\/$|^136A$|^RCFR$|^COFC\.REQ$|^PTA\.PET$|^MFEE\.ADDR$|^PET\.OP\.REV$|^PET\.PCT$|^RFP$|^PABC$/.test(codeUpper)) return "applicant_request";
  if (/^IGRA7$|^1001P$|^1200P$|^RO101E$|^EXRE92$/.test(codeUpper)) return "applicant_request";
  if (/^A621$|^A621-JP$/.test(codeUpper)) return "applicant_request";

  // === Responses (申请人答复 - replies to office actions, amendments) ===
  if (/amendments? received before examination/.test(descLower)) return "response";
  if (/amended claims filed after receipt of/.test(descLower)) return "response";
  if (/amended description filed after receipt of/.test(descLower)) return "response";
  if (/amended claims with annotations/.test(descLower)) return "response";
  if (/amended description with annotations/.test(descLower)) return "response";
  if (/reply to communication from the examining division/.test(descLower)) return "response";
  if (/reply to the invitation to remedy/.test(descLower)) return "response";
  if (/substitute sheet/.test(descLower)) return "response";
  if (/request for substantive examination/.test(descLower)) return "response";
  if (/statement of opinions|opinion statement/.test(descLower)) return "response";
  if (/correction|amendment.*replacement|replacement page/.test(descLower)) return "response";
  if (/reexamination request|request for reexamination/.test(descLower)) return "response";
  if (/invalidation request|request for invalidation/.test(descLower)) return "response";
  if (/written opinion/.test(descLower)) return "response";
  if (/written amendment/.test(descLower)) return "response";
  if (/erwidung/.test(descLower)) return "response";
  if (/beschränkung/.test(descLower)) return "response";
  if (/antrag.*erteilung/.test(descLower)) return "response";
  if (/prüfungsantrag/.test(descLower)) return "response";
  if (/einspruch/.test(descLower)) return "response";
  if (/beschwerde/.test(descLower)) return "response";
  if (/preliminary amendment/.test(text)) return "response";
  if (/pre.?exam formalities/.test(text)) return "response";
  if (/election.*restriction.*filed/.test(text)) return "response";
  if (/amendment.*after.*non.?final|reconsideration.*after.*non.?final/.test(text)) return "response";
  if (/response after final|after final consideration/.test(text)) return "response";
  if (/amendment.*after.*notice of allowance/.test(text)) return "response";
  if (/applicant argument|applicant remark|remarks made in an amendment/.test(text)) return "response";
  if (/notice of appeal filed/.test(text)) return "response";
  if (/^CTED$|^CTEQ$|^AMSB$|^A\.NE$|^A\.NE\.AFCP$|^A\.NA$|^REM$|^AFCP$|^BRAP$|^REBR$|^NOAP$/.test(codeUpper)) return "response";
  if (/^IFEE$|^PA$/.test(codeUpper)) return "response";
  if (/^ABEX$|^CLMSABEX$|^DESCABEX$|^EXRE3$|^FORAREPLY$|^CLMS-HWA$|^DESC-HWA$|^RO-DESC-26$/.test(codeUpper)) return "response";
  if (/^200104-CN$|^200105-CN$|^200106-CN$|^200107-CN$|^200108-CN$/.test(codeUpper)) return "response";
  if (/^A53$|^A523$/.test(codeUpper)) return "response";
  if (/response|amendment|reply|remand/.test(text) && !/notification/.test(text)) return "response";
  if (/答复|修改|补正|意见陈述/.test(text)) return "response";

  // === Notifications (通知) ===
  if (/notification of forthcoming publication/.test(descLower)) return "notification";
  if (/reminder.*payment.*examination fee|reminder.*designation fee/.test(descLower)) return "notification";
  if (/invitation to confirm maintenance/.test(descLower)) return "notification";
  if (/invitation to declare maintenance/.test(descLower)) return "notification";
  if (/communication regarding the transmission of the european search report/.test(descLower)) return "notification";
  if (/transmission of the certificate/.test(descLower)) return "notification";
  if (/expiry of opposition period/.test(descLower)) return "notification";
  if (/application deemed to be withdrawn/.test(descLower)) return "notification";
  if (/communication to designated inventor/.test(descLower)) return "notification";
  if (/acknowledgement of receipt/.test(descLower)) return "notification";
  if (/invitation to indicate the basis for amendments/.test(descLower)) return "notification";
  if (/grant of extension of time limit/.test(descLower)) return "notification";
  if (/refund of fees/.test(descLower)) return "notification";
  if (/brief communication to applicant/.test(descLower)) return "notification";
  if (/letter relating to.*revocation.*automatic debiting/.test(descLower)) return "notification";
  if (/communication concerning.*withdrawal.*automatic debiting/.test(descLower)) return "notification";
  if (/registration.*notice|registration procedure/.test(descLower)) return "notification";
  if (/bescheid/.test(descLower)) return "notification";
  if (/anschreiben/.test(descLower)) return "notification";
  if (/empfangsbestätigung/.test(descLower)) return "notification";
  if (/bibliographie.*mitteilung|bibliografie.*mitteilung/.test(descLower)) return "notification";
  if (/abandonment/.test(text)) return "notification";
  if (/notice of publication/.test(text)) return "notification";
  if (/pre-brief appeal conference decision/.test(text)) return "notification";
  if (/notice|notification/.test(text) && !/patent_doc|citation|allowance/.test(text)) return "notification";
  if (/ecofc|cofc.*post|cofc.*supervisory|cofc.*petition/i.test(text)) return "notification";
  if (/certificate of correction - post issue communication/i.test(text)) return "notification";
  if (/supervisory patent examiner response.*certificate of correction/i.test(text)) return "notification";
  if (/petition decision routed to certificate of correction/i.test(text)) return "notification";
  if (/^CTAV$|^A\.NE\.AFCP\.D$|^EXIN$|^N417$|^N570$|^N572$|^M327$|^PET\.OP\.DEC$|^PETDEC$|^PET\.DEC\.TC$|^SES\.LOSS$|^ABN$|^NTC\.PUB$|^DO\.EO|^PTO\.FEE$|^N417\.PYMT$|^DAFP$|^NRPD$|^PABC\.D$|^ECOFC|^COFC\.POST$|^COFC\.SPE\.RET$|^COFC\.PET\.DEC$/.test(codeUpper)) return "notification";
  if (/^APP\.FILE\.REC$|^1001-6E$|^1048$|^1045$|^1117$|^1128$|^1133$|^1219$|^1081$|^1082$|^1224$|^1225$|^1226$|^1195$|^1507$|^2047$|^2057$|^2907$|^2909$|^2911$|^2913$|^2944A$|^1205N$|^IB306$|^2548$|^RO106$|^RO105$/.test(codeUpper)) return "notification";
  if (/^200202-CN$/.test(codeUpper)) return "notification";
  if (/通知|notification/.test(text)) return "notification";

  // === Misc (其他文件) - 归到通知栏 ===
  if (/european search report|supplementary european search report/.test(descLower)) return "notification";
  if (/letter accompanying subsequently filed items/.test(descLower)) return "notification";
  if (/priority document/.test(descLower)) return "notification";
  if (/examination started/.test(descLower)) return "notification";
  if (/search started/.test(descLower)) return "notification";
  if (/transmittal of new application/.test(text)) return "notification";
  if (/certified copy/.test(text)) return "notification";
  if (/erfinderbenennung/.test(descLower)) return "notification";
  if (/offenlegungsschrift/.test(descLower)) return "notification";
  if (/patentschrift/.test(descLower)) return "notification";
  if (/teilung/.test(descLower)) return "notification";
  if (/schutzbereich/.test(descLower)) return "notification";
  if (/request for a patent/.test(descLower)) return "notification";
  if (/^CTMS$|^M$|^N$|^P$|^WFEE$|^PA\.\.$|^R3\.73$|^TRAN\.LET$|^IMIS$|^SCORE$|^TRN$|^CFP$|^WELCOME\.LET$|^PD\.FILED\.F$/.test(codeUpper)) return "notification";
  if (/^1002$|^PRIO$|^PRIODOC|^PRSR-SRCH$|^PRSR-NON$|^1038$|^RECEIPT-OLF$|^SRCH-START$|^EX-START$|^INCANNEX$|^CDAPPR|^CD-FREP$|^RETURNED$|^FEES-RO$|^PAYREJ$|^INVT$|^A1PAMPHLET$|^IPRP$|^RO-LETT$|^1201-1$|^SRCH$/.test(codeUpper)) return "notification";

  return "notification";
}

// EPO Global Dossier 文档描述→中文翻译映射
// EPO 降级源返回的文档标题是英文的，这里统一映射为中文（与 US codeMap 保持一致）
// 键为小写英文描述片段（getStatusInfo 中用 includes 匹配，按长度降序排列）
var EPO_DESC_MAP = {
  // ── 审查意见类 ──
  "non-final rejection": "非最终驳回 (Non-Final Rejection)",
  "final rejection": "最终驳回 (Final Rejection)",
  "examiner's answer": "审查员复审答辩意见 (Examiner's Answer)",
  "office action": "审查意见 (Office Action)",
  "examination report": "审查报告 (Examination Report)",
  "examination communication": "审查通信 (Examination Communication)",
  "search opinion": "检索意见 (Search Opinion)",
  "written opinion": "书面意见 (Written Opinion)",
  // ── 申请人答复类 ──
  "amendment after non-final": "非最终驳回后修改 (Amendment after Non-Final)",
  "amendment": "修改 (Amendment)",
  "response": "答复 (Response)",
  "reply": "答复 (Reply)",
  "observations": "意见陈述 (Observations)",
  "remarks": "意见陈述 (Remarks)",
  "arguments": "申请人意见 (Arguments)",
  "request for reconsideration": "重新考虑请求 (Request for Reconsideration)",
  "request for continued examination": "请求继续审查 (Request for Continued Examination)",
  "appeal brief": "复审请求书 (Appeal Brief)",
  "reply brief": "复审答复书 (Reply Brief)",
  // ── 授权通知类 ──
  "notice of allowance": "授权通知 (Notice of Allowance)",
  "intention to grant": "授权意向 (Intention to Grant)",
  "grant notification": "授权通知 (Grant Notification)",
  "issue notification": "授权公告通知 (Issue Notification)",
  "issue information": "授权信息 (Issue Information)",
  "decision to grant": "授权决定 (Decision to Grant)",
  "grant of patent": "专利授权 (Grant of Patent)",
  // ── 引用文献/IDS类 ──
  "information disclosure": "信息披露声明 (Information Disclosure Statement)",
  "foreign reference": "外国引用文献 (Foreign Reference)",
  "priority documents electronically retrieved": "电子检索优先权文件 (Priority Documents electronically retrieved by USPTO from a participating IP Office)",
  "list of references": "引用文献列表 (List of References)",
  "cited by examiner": "审查员引用 (Cited by Examiner)",
  "references cited": "引用文献 (References Cited)",
  "european search report": "欧洲检索报告 (European Search Report)",
  "search report": "检索报告 (Search Report)",
  "search strategy": "检索策略 (Search Strategy)",
  "search information": "检索信息 (Search Information including Classification, Databases and Other Search Related Notes)",
  // ── 专利文件类 ──
  "claims": "权利要求 (Claims)",
  "specification": "说明书 (Specification)",
  "drawings-only black and white line drawings": "黑白线条图 (Drawings - Black and White Line Drawings)",
  "drawings": "附图 (Drawings)",
  "abstract": "摘要 (Abstract)",
  "bibliographic data": "书目数据 (Bibliographic Data)",
  "sequence listing": "序列表 (Sequence Listing)",
  "english translation of the claims": "权利要求英文翻译 (English Translation of the Claims)",
  // ── 通知类 ──
  "electronic filing system acknowledgment receipt": "电子提交确认回执 (Electronic Filing System Acknowledgment Receipt)",
  "filing receipt": "申请受理回执 (Filing Receipt)",
  "notice of publication": "公开通知 (Notice of Publication)",
  "publication": "公开 (Publication)",
  "power of attorney": "代理委托书 (Power of Attorney)",
  "change of address": "地址变更 (Change of Address)",
  "electronic fee payment": "电子缴费 (Electronic Fee Payment)",
  "fee worksheet": "费用工作表 (Fee Worksheet)",
  "issue fee": "授权费 (Issue Fee)",
  "extension of time": "期限延长 (Extension of Time)",
  "authorization for extension": "期限延长授权 (Authorization for Extension of Time)",
  "transmittal letter": "传送信函 (Transmittal Letter)",
  "transmittal": "传送 (Transmittal)",
  "withdrawn": "撤回 (Withdrawn)",
  "refused": "驳回 (Refused)",
  "deemed": "视为 (Deemed)",
  "entry into european phase": "进入欧洲阶段 (Entry into European Phase)",
  "european phase": "欧洲阶段 (European Phase)",
  "assignee": "受让人 (Assignee)",
  "ownership": "所有权 (Ownership)",
  "declaration": "声明 (Declaration)",
  "oath": "宣誓 (Oath)",
  // ── EPO/GD 特有 ──
  "placeholder sheet indicating presence of supplemental content": "补充内容占位页 (Supplemental Complex Repository for Examiners - SCORE)",
  "supplemental complex repository": "补充内容占位页 (Supplemental Complex Repository for Examiners - SCORE)",
  "opposition": "异议 (Opposition)",
};

// 按键长度降序排列，确保长描述优先匹配（避免"non-final rejection"被"rejection"截胡）
var _epoDescMapSortedKeys = Object.keys(EPO_DESC_MAP).sort((a, b) => b.length - a.length);

// 根据 EPO 描述键推断文档类型（用于看板分类）
function _classifyEpoDescType(key) {
  // 审查意见类
  if (["non-final rejection", "final rejection", "examiner's answer", "office action",
       "examination report", "examination communication", "search opinion",
       "written opinion"].includes(key)) return "office_action";
  // 申请人答复类
  if (["amendment after non-final", "amendment", "response", "reply", "observations",
       "remarks", "arguments", "request for reconsideration",
       "appeal brief", "reply brief"].includes(key)) return "response";
  // 申请人其他请求类
  if (["request for continued examination", "entry into european phase", "european phase",
       "extension of time", "authorization for extension"].includes(key)) return "applicant_request";
  // 授权通知类
  if (["notice of allowance", "intention to grant", "grant notification",
       "issue notification", "issue information", "decision to grant", "grant of patent"].includes(key)) return "allowance";
  // 引用文献/IDS类（检索策略归入此类，与 classifyDocCode 和 EP codeMap 保持一致）
  if (["information disclosure", "foreign reference",
       "priority documents electronically retrieved", "list of references",
       "cited by examiner", "references cited", "european search report",
       "search report", "search strategy", "search information"].includes(key)) return "citation";
  // 专利文件类
  if (["claims", "specification", "drawings-only black and white line drawings",
       "drawings", "abstract", "bibliographic data", "sequence listing",
       "english translation of the claims"].includes(key)) return "patent_doc";
  // 异议类
  if (key === "opposition") return "misc";
  // 默认为通知类
  return "notification";
}

// 根据 EPO 描述键推断审查阶段
function _classifyEpoDescStage(key) {
  if (["notice of allowance", "intention to grant", "grant notification",
       "issue notification", "issue information", "decision to grant", "grant of patent",
       "issue fee"].includes(key)) return "授权";
  if (["appeal brief", "reply brief"].includes(key)) return "复审";
  if (["filing receipt", "electronic filing system acknowledgment receipt",
       "transmittal letter", "transmittal"].includes(key)) return "审查前";
  return "审查中";
}

function getStatusInfo(office, code, desc) {
  const officeMap = PATENT_STATUS[office];
  const upperCode = (code || "").toUpperCase();

  // 1) 优先用 office codeMap 精确匹配（GD 正常源返回的 docCode）
  if (officeMap && officeMap.codeMap[upperCode]) {
    const info = officeMap.codeMap[upperCode];
    return { name: info.name, type: info.type, stage: info.stage };
  }

  // 2) office codeMap 未命中：先用 office descMap 模糊匹配（常规 GD 兜底）
  //    命中即返回，避免被 EPO_DESC_MAP 的短键（如 "amendment"）截胡更精确的 descMap 条目
  if (officeMap && officeMap.descMap && desc) {
    const descLower = desc.toLowerCase();
    const sortedKeys = Object.keys(officeMap.descMap).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      if (descLower.includes(key)) {
        let type = classifyDocCode(code, desc);
        if (type === "misc") type = "notification";
        return { name: officeMap.descMap[key], type, stage: "审查中" };
      }
    }
  }

  if (!officeMap) return { name: desc || code || "未知文件", type: "notification", stage: "未知" };

  // 3) office codeMap + descMap 均未命中：尝试 EPO 描述映射（EPO 降级源返回的英文标题）
  //    epoClassifyDoc 返回的 FREC/PUB/POA/TRANS/DWG 等码不在任何 office codeMap 中，
  //    会走到这里；用 EPO_DESC_MAP 把英文标题翻译成中文
  if (desc) {
    const descLower = desc.toLowerCase();
    for (const key of _epoDescMapSortedKeys) {
      if (descLower.includes(key)) {
        const epoType = _classifyEpoDescType(key);
        return { name: EPO_DESC_MAP[key], type: epoType, stage: _classifyEpoDescStage(key) };
      }
    }
  }

  // 4) 最终兜底：返回原始描述/代码
  const type = classifyDocCode(code, desc);
  const typeName = officeMap.typeNames[type] || "通知";
  let result = { name: desc || code || typeName, type, stage: "审查中" };
  if (result.type === "misc") {
    const fallbackType = classifyDocCode(code, desc);
    result.type = fallbackType === "misc" ? "notification" : fallbackType;
  }
  return result;
}

function shouldIncludeInAIAnalysis(office, type) {
  const officeMap = PATENT_STATUS[office];
  if (!officeMap || !officeMap.aiAnalysisTypes) return type === "office_action" || type === "response";
  return officeMap.aiAnalysisTypes.indexOf(type) !== -1;
}

// Check if a document is a claims-type patent document (e.g. CLM, FWCLM, ETCL, CLMS, translations)
// Used to determine default selection for AI review and merge export.
function isClaimsDocument(it) {
  if (!it) return false;
  if (it.type !== "patent_doc") return false;
  const code = String(it.docCode || "").toUpperCase();
  // Common claims document codes across offices
  if (/^CLM|^FWCLM|^ETCL$|^CLMS/.test(code)) return true;
  const name = String(it.name || "") + " " + String(it.desc || "");
  if (/权利要求/.test(name)) return true;
  return false;
}

// Default selection rule for "review" and "mergeExport" modes:
// all office_action + all response + claims-type patent documents.
// 申请人答复(response)和专利文件(patent_doc)栏中的"表"类型（如权利要求工作表、
// 费用工作表等）不纳入默认选择——这些表格通常是程序性附件，对审查意见梳理无价值。
function shouldDefaultSelectForAnalysis(it) {
  if (!it) return false;
  if (it.type === "office_action") return true;
  if (it.type === "response") return !isTableLikeDocument(it);
  if (it.type === "patent_doc") {
    if (isTableLikeDocument(it)) return false;
    return isClaimsDocument(it);
  }
  return false;
}

// 判断是否为"表"类型文档：权利要求工作表/费用工作表/书目数据表/任何 worksheet/table/sheet
function isTableLikeDocument(it) {
  if (!it) return false;
  const code = String(it.docCode || "").toUpperCase();
  const name = String(it.name || "") + " " + String(it.desc || "");
  const nameLower = name.toLowerCase();
  // 已知"表"类文档代码
  if (/^WFEE$|^CLMSTRAN$|^BIB$/.test(code)) return true;
  // 中文含"表"字（排除"表达"/"表示"等词组，但表格类文档名通常含"工作表"/"数据表"/"索引表"）
  if (/工作表|数据表|索引表|费用表|书目表/.test(name)) return true;
  // 英文 worksheet / table / sheet
  if (/\bworksheet\b|\btable\b|\bsheet\b/i.test(nameLower)) return true;
  return false;
}
