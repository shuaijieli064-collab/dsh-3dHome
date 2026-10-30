## 角色 · 小拾

首位 Agent 小人的单体展示，位于房屋右前方的木质展示台（`#character` 预设直达）。

**模型化是唯一路线**：小拾由 Blender 按 `角色三视图（正面_侧面_背面）.png` 手建，导出为 `src/scene/assets/xiaoshi.glb`，由仓库自研的极简 GLB 解析器加载。**程序化拼装版（`createCharacter`）已删除**——还原度不够，直接弃用。房屋与家具仍是程序化建模，只有角色走模型。

**当前模型实测**：80 MB，单网格单材质（`Material.001`），91.1 万顶点，内嵌 3 张 PNG（基础色 20 MB / 法线 7 MB / 金属粗糙度 9 MB），无命名部件节点、无动画，脸直接画在基础色贴图上。归一化后台上身高 1.76 m（含 `scale 1.6`），脚底落在台面 `y=0.09`。

**文件分工**：

| 文件 | 内容 |
| --- | --- |
| `src/scene/characterModel.js` | 加载 GLB → 归一化到 1.10 身高 → 换色 → 挂动画；`loadModelIntoStage` 注入展示台 |
| `src/scene/glbLoader.js` | 零依赖极简 GLB 解析器（几何 + 材质 + 内嵌贴图 + 节点层级；不支持蒙皮 / Draco） |
| `src/scene/characters.js` | 展示台 `buildCharacterStage`（台座 + 名牌 + 聚光/补光）+ 6 套住客调色板 `CHAR_PALETTES` |
| `src/scene/characterTextures.js` | Canvas 贴图：toon 色阶图、表情贴片（规范模型才用）、木质名牌 |

**换模型**：新 GLB 覆盖 `src/scene/assets/xiaoshi.glb` 即可，或改 `characterModel.js` 顶部的 `CHARACTER_MODEL_URL`。命名规范（节点名 `Head` / `Dress` / `Ahoge` / `Tail` / `Fin_L` / `Fin_R`、材质名 `mat_hair` 等、导出设置、头部对位尺寸）见 `src/scene/assets/建模与命名规范.txt`。

**动画按模型能力分两档**：

- 带上述命名节点的规范模型 → 呼吸、眨眼、鲸尾慢摆、呆毛弹簧、鳍摆全部生效，脸由 Canvas 表情贴片绘制。
- 当前这种单网格贴图模型 → 只有展示台的整体左右轻转（面向镜头摆动）；没有可驱动的部件节点，脸用模型自带贴图。

**表情接口**（仅规范模型有效，单网格模型调用是空操作）：

```
character.userData.setExpression('normal' | 'smile' | 'surprised' | 'closed')
```

浏览器控制台调试入口：

```js
window.homeScene.home.characterStage.character.userData.setExpression('smile')
```

**加载失败不再静默**：`loadModelIntoStage` 失败会重试 2 次（间隔 1.5 s），仍失败则打 `console.error`（带模型路径）并让台子空着。因为没有程序化兜底了——**台子空 = 模型没加载上**，看控制台第一条 error 就知道原因。

**亮相动画**：台子 `tick` 委托给当前 `stage.userData.character.userData.animate`，再叠加左右轻转；舞台聚光与补光自定义为灯组（`isLamp`），夜晚模式不受房屋灯光变暗影响。

**6 套住客调色板**：`CHAR_PALETTES` 按 `marvis/file/computer/app/browser/search` 预留。注意：对当前这个贴图模型**不生效**（材质名不是 `mat_*`，`applyPalette` 匹配不到角色），只有按规范重建的模型才会被换色。后续小人进屋时按房间取色。

### 待办：模型瘦身

`xiaoshi.glb` 80 MB 且未压缩（解析器不支持 Draco / Meshopt），首屏需数秒；根目录另有一份同名 `小拾.glb`，两处合计 160 MB。想瘦身：减面 + 基础色贴图降到 2K，观感损失很小。

