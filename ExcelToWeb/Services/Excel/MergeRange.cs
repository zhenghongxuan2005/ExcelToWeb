using System.Text.Json.Serialization;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 一个被记录下来的合并区域，导出时按原样还原。
///
/// 存的是「列名数组 + 导入时的数据行数」而不是裸列下标：导入之后用户可能改列名、
/// 移动列甚至删列，下标会失效，而列名能重新查回当前位置。行数一旦对不上就整条放弃
/// —— 宁可少还原几个区域，也不能还原到错误的位置上。
/// </summary>
public sealed class MergeRange
{
    /// <summary>起始行（1 基，含表头行）</summary>
    [JsonPropertyName("r1")] public int R1 { get; set; }

    /// <summary>起始列（1 基，导入当时）</summary>
    [JsonPropertyName("c1")] public int C1 { get; set; }

    [JsonPropertyName("r2")] public int R2 { get; set; }

    [JsonPropertyName("c2")] public int C2 { get; set; }

    /// <summary>区域覆盖的列名（按导入时的表头，已过去重）</summary>
    [JsonPropertyName("cols")] public List<string> Cols { get; set; } = new();

    /// <summary>导入时的数据行数；导出时当前行数与之不符则不还原</summary>
    [JsonPropertyName("rowCount")] public int RowCount { get; set; }
}
