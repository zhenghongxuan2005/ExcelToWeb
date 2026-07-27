# 📊 Excel 在线编辑工具

一个基于 ASP.NET Core + SQL Server 的 Excel 数据在线编辑与管理系统。

## ✨ 功能

- 📤 上传 Excel 文件（支持 .xlsx / .xls）
- 📋 自动解析并展示为网页表格
- ✏️ 在线编辑数据（点击单元格即可修改）
- 💾 保存数据到 SQL Server 数据库
- 📊 导出为 Excel 文件
- 🔄 刷新数据、清空表格
- 📅 自动识别并转换日期格式

## 🛠️ 技术栈

- **前端**：HTML + CSS + JavaScript
- **后端**：C# + ASP.NET Core 10
- **数据库**：SQL Server + Entity Framework Core
- **Excel 解析**：EPPlus

## 📁 项目结构
ExcelToWeb/
├── Controllers/ # API 控制器
├── Data/ # 数据库上下文
├── Models/ # 数据模型
├── wwwroot/ # 前端页面
│ ├── css/ # 样式文件
│ ├── js/ # JavaScript 逻辑
│ └── index.html # 主页面
└── Program.cs # 程序入口


## 🚀 本地运行

1. 克隆仓库
   ```bash
   git clone https://github.com/zhenghongxuan2005/ExcelToWeb.git修改 appsettings.json 中的数据库连接字符串
2.修改 appsettings.json 中的数据库连接字符串
3.在 SSMS 中执行建表 SQL（位于项目文档中）
4.按 F5 运行项目
