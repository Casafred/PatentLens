import type { PatentLensHost } from '@/types/host'
export function getHost(): PatentLensHost {
  if (window.parent === window || window.parent.location.origin !== location.origin) {
    throw new Error('请从 PatentLens 打开权利要求成图工作台')
  }
  const host = window.parent.Patent2PicHost
  if (!host) throw new Error('PatentLens 成图接口尚未就绪')
  return host
}
