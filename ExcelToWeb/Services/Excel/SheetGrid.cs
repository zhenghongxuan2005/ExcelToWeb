using OfficeOpenXml;

namespace ExcelToWeb.Services.Excel;

/// <summary>一个合并区域在工作表里的坐标（1 基）</summary>
public readonly record struct MergeArea(int R1, int C1, int R2, int C2);

/// <summary>
/// 工作表取值矩阵：先把单元格值读进内存（并按合并区域铺平），后续的表头识别与
/// 数据行解析都从矩阵读。
///
/// 为什么不直接往 worksheet 上铺：「被合并掉的格子」也要拿到左上角的值，而在
/// worksheet 上写值会留下样式与单元格状态，影响后续的格式化判断；在内存里铺完即扔，
/// 副作用为零。
/// </summary>
public static class SheetGrid
{
    /// <summary>读值 + 按合并区域铺平，返回矩阵与生效的区域列表</summary>
    public static (string[,] Grid, List<MergeArea> Areas) Build(ExcelWorksheet worksheet, int rowCount, int colCount)
    {
        var grid = new string[rowCount, colCount];
        for (int r = 1; r <= rowCount; r++)
        {
            for (int c = 1; c <= colCount; c++)
                grid[r - 1, c - 1] = worksheet.Cells[r, c]?.Text ?? string.Empty;
        }

        var areas = CollectAreas(worksheet, rowCount, colCount);
        foreach (var area in areas)
        {
            var value = grid[area.R1 - 1, area.C1 - 1];
            for (int r = area.R1; r <= area.R2; r++)
            {
                for (int c = area.C1; c <= area.C2; c++)
                    grid[r - 1, c - 1] = value;
            }
        }

        return (grid, areas);
    }

    /// <summary>
    /// 收集有效的合并区域：跳过单格区域；越出 Dimension 的丢弃（损坏文件）；
    /// Excel 本身不允许区域交叉，真遇到交叉就只保留先到的那个 —— 与其铺出一片
    /// 难以解释的值，不如少认一个区域。
    /// </summary>
    private static List<MergeArea> CollectAreas(ExcelWorksheet worksheet, int rowCount, int colCount)
    {
        var areas = new List<MergeArea>();

        // EPPlus 把合并区域以 "A1:B2" 这样的 ref 字符串暴露出来，需要自己解析
        foreach (var reference in worksheet.MergedCells)
        {
            if (string.IsNullOrWhiteSpace(reference)) continue;

            MergeArea area;
            try
            {
                var address = new ExcelAddress(reference);
                area = new MergeArea(address.Start.Row, address.Start.Column, address.End.Row, address.End.Column);
            }
            catch (Exception)
            {
                continue;   // 损坏文件里的非法 ref：跳过这条，不影响其它区域
            }

            if (area.R2 <= area.R1 && area.C2 <= area.C1) continue;     // 单格
            if (area.R1 < 1 || area.C1 < 1) continue;
            if (area.R2 > rowCount || area.C2 > colCount) continue;     // 越界
            if (areas.Any(a => Overlaps(a, area))) continue;            // 交叉

            areas.Add(area);
        }

        return areas;
    }

    private static bool Overlaps(MergeArea a, MergeArea b) =>
        a.R1 <= b.R2 && b.R1 <= a.R2 && a.C1 <= b.C2 && b.C1 <= a.C2;
}
