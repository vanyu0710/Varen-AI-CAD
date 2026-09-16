Varen CAD 打包版（Windows x64）
================================

一、快速开始
  1. 解压本目录到任意路径（路径含中文/空格没问题，但建议避免只读目录）。
  2. 把 .env.example 复制为 .env，填入你的模型 API key（见文件内注释）。
     不填也能启动，只是 AI agent 建模不可用。
  3. 双击 VarenCAD.exe —— 稍等几秒，浏览器会自动打开 http://127.0.0.1:8001。
     控制台窗口会自动隐藏；想关掉程序，结束 VarenCAD.exe 进程即可。

二、目录说明
  VarenCAD.exe        主程序（应用 + CAD 内核 worker 同一个 exe）
  _internal\          程序依赖（勿删勿改）
  runtime\python\     计算沙箱用的嵌入式 Python（勿删）
  .env                你的配置（自己创建）
  work\               运行时数据：项目零件库、建模产物、日志
  work\varen-cad.log  主程序日志（排障先看这个）

三、常见问题
  · 首次启动慢 / 被杀毒软件拦截：exe 未做代码签名，Windows Defender 或杀软
    可能弹警告或拖慢首次运行，属正常现象，添加信任即可。
  · 端口被占用：在 .env 里改 MECHCAD_PORT。
  · 建模卡住：看 work\varen-cad.log；内核子进程日志在其 stderr（已并入主日志）。
  · 换机器部署：整个文件夹拷走即可，无安装步骤、不写注册表。

四、已知限制
  · 打包版不含 FreeCAD；「通用引擎」路径（/api/generate 等）使用随包的
    build123d 引擎执行，功能可用。
  · 内核为 AGPL-3.0-or-later（mechcad-kernel）：对外分发本程序时，
    需随包提供对应源码或书面源码要约，并保留内核版权声明。

—— 2026-09-15 构建
