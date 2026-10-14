# 多阶段构建：SDK 阶段还原 + 发布，运行时阶段只带 ASP.NET Core 运行时
# 构建：docker build -t excel-to-web .
# 运行：docker run -p 8080:8080 -e ConnectionStrings__DefaultConnection="..." -e Jwt__Key="..." excel-to-web

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
# 先只拷贝 csproj 还原依赖，源码变化时可复用这一层缓存
COPY ExcelToWeb/ExcelToWeb.csproj ExcelToWeb/
RUN dotnet restore ExcelToWeb/ExcelToWeb.csproj
COPY . .
RUN dotnet publish ExcelToWeb/ExcelToWeb.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app/publish .
# aspnet 镜像是 Debian slim，不带 curl/wget，装一个供 HEALTHCHECK 使用
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
# 容器健康判定探 /health（liveness）而非 /health/ready——
# 自愈重启决策不应被外部数据库的闪断拖垮
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD curl -fsS http://localhost:8080/health || exit 1
# ASP.NET Core 容器镜像默认监听 8080，由 ASPNETCORE_URLS 注入（Program.cs 不再硬编码端口）
EXPOSE 8080
ENTRYPOINT ["dotnet", "ExcelToWeb.dll"]
