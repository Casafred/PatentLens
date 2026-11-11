import { Graph } from '@antv/x6'

let registered = false

/**
 * 注册方法类权利要求的自定义节点形状
 * - decision: 菱形（逻辑判断）
 * - condition: 六边形（触发条件）
 * 必须在 GraphEngine.init() 之前调用
 */
export function registerMethodShapes(): void {
  if (registered) return
  registered = true

  // 菱形 - decision 节点
  Graph.registerNode('decision', {
    inherit: 'polygon',
    width: 140,
    height: 100,
    attrs: {
      body: {
        refPoints: '0.5,0 1,0.5 0.5,1 0,0.5',
        fill: '#f3e8ff',
        stroke: '#722ed1',
        strokeWidth: 2,
      },
      label: {
        fontSize: 13,
        fill: '#1d2129',
        fontWeight: 'bold',
        textAnchor: 'middle',
        textVerticalAnchor: 'middle',
      },
    },
    ports: {
      groups: {
        top: { position: 'top', attrs: { circle: { r: 4, magnet: true, stroke: '#722ed1', fill: '#fff', strokeWidth: 1 } } },
        bottom: { position: 'bottom', attrs: { circle: { r: 4, magnet: true, stroke: '#722ed1', fill: '#fff', strokeWidth: 1 } } },
        left: { position: 'left', attrs: { circle: { r: 4, magnet: true, stroke: '#722ed1', fill: '#fff', strokeWidth: 1 } } },
        right: { position: 'right', attrs: { circle: { r: 4, magnet: true, stroke: '#722ed1', fill: '#fff', strokeWidth: 1 } } },
      },
    },
  })

  // 六边形 - condition 节点
  Graph.registerNode('condition', {
    inherit: 'polygon',
    width: 160,
    height: 60,
    attrs: {
      body: {
        refPoints: '0.25,0 0.75,0 1,0.5 0.75,1 0.25,1 0,0.5',
        fill: '#fff7e6',
        stroke: '#fa8c16',
        strokeWidth: 1.5,
      },
      label: {
        fontSize: 13,
        fill: '#1d2129',
        fontWeight: 'bold',
        textAnchor: 'middle',
        textVerticalAnchor: 'middle',
      },
    },
    ports: {
      groups: {
        top: { position: 'top', attrs: { circle: { r: 4, magnet: true, stroke: '#fa8c16', fill: '#fff', strokeWidth: 1 } } },
        bottom: { position: 'bottom', attrs: { circle: { r: 4, magnet: true, stroke: '#fa8c16', fill: '#fff', strokeWidth: 1 } } },
        left: { position: 'left', attrs: { circle: { r: 4, magnet: true, stroke: '#fa8c16', fill: '#fff', strokeWidth: 1 } } },
        right: { position: 'right', attrs: { circle: { r: 4, magnet: true, stroke: '#fa8c16', fill: '#fff', strokeWidth: 1 } } },
      },
    },
  })
}
