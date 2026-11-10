# 站点精简宋体

`bnu-serif.woff2` 由 Adobe [思源宋体](https://github.com/adobe-fonts/source-han-serif) 的 `SubsetOTF/CN/SourceHanSerifCN-Regular.otf` 精简生成，采用本目录的 SIL Open Font License 1.1。修改后的字体家族名为 BNU Serif。

字集取自 `public` 下 HTML 与非压缩 JavaScript 中的中日韩统一表意文字；其他字符由系统字体回退。新增固定文案需要扩大字集时，可使用 fonttools 和 brotli 重新生成，并将字体内部的家族名、全名及 PostScript 名称改为不含保留名称 Source 的名称。
