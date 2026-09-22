using ExcelToWeb.Models;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 单行数据校验引擎：把「某一行数据 vs 该表配置的校验规则」的判定集中在一处，
/// 原先这段逻辑内嵌在 ExcelService 的上传方法里，占用了近 100 行。
/// </summary>
public class RowValidator
{
    /// <summary>校验一行，返回该行全部错误描述；返回空列表表示通过</summary>
    public List<string> ValidateRow(Dictionary<string, object> row, IEnumerable<ValidationRule> rules)
    {
        var errors = new List<string>();

        foreach (var rule in rules)
        {
            var columnName = rule.ColumnName;
            if (!row.ContainsKey(columnName)) continue;

            var value = row[columnName]?.ToString() ?? string.Empty;

            // 必填优先，命中后不再做类型判断
            if (rule.Required && string.IsNullOrEmpty(value))
            {
                errors.Add($"{columnName} 不能为空");
                continue;
            }

            // 非必填且为空 → 不做进一步校验
            if (string.IsNullOrEmpty(value)) continue;

            ValidateValue(rule, columnName, value, errors);
        }

        return errors;
    }

    /// <summary>
    /// 跨行唯一性校验：检查 rows 里启用 Unique 约束的列是否存在重复值。
    /// 逐行校验（ValidateRow）看不到其它行，所以唯一性必须在整批数据上做；
    /// 错误直接归并到 perRowErrors（与 ValidateRow 的输出同一载体），由调用方统一汇总。
    /// </summary>
    /// <param name="rows">本批数据（导入的新行 或 保存时的整表）</param>
    /// <param name="rules">该表全部校验规则（只取 Unique = true 的）</param>
    /// <param name="rowNumbers">与 rows 对齐的行号（用于报错定位）；null 时用 1..N</param>
    /// <param name="perRowErrors">每行错误的收集器（长度须等于 rows.Count）</param>
    public void ValidateUniqueness(
        List<Dictionary<string, object>> rows, IEnumerable<ValidationRule> rules,
        IReadOnlyList<int>? rowNumbers, List<string>[] perRowErrors)
    {
        foreach (var rule in rules.Where(r => r.Unique))
        {
            var seen = new Dictionary<string, int>(StringComparer.Ordinal);
            for (int i = 0; i < rows.Count; i++)
            {
                if (!rows[i].TryGetValue(rule.ColumnName, out var raw)) continue;
                var value = raw?.ToString() ?? string.Empty;
                if (value == string.Empty) continue;   // 空值不参与唯一性（由 Required 管）

                if (seen.TryGetValue(value, out var firstAt))
                {
                    var firstRowNo = rowNumbers != null && firstAt < rowNumbers.Count ? rowNumbers[firstAt] : firstAt + 1;
                    perRowErrors[i].Add($"{rule.ColumnName} 的值「{value}」与第 {firstRowNo} 行重复");
                }
                else
                {
                    seen[value] = i;
                }
            }
        }
    }

    private static void ValidateValue(ValidationRule rule, string columnName, string value, List<string> errors)
    {
        switch (rule.DataType)
        {
            case "number":
                if (!decimal.TryParse(value, out var number))
                {
                    errors.Add($"{columnName} 必须是数字");
                    return;
                }
                if (rule.MinValue.HasValue && number < rule.MinValue.Value)
                    errors.Add($"{columnName} 不能小于 {rule.MinValue.Value}");
                if (rule.MaxValue.HasValue && number > rule.MaxValue.Value)
                    errors.Add($"{columnName} 不能大于 {rule.MaxValue.Value}");
                break;

            case "date":
                if (!DateTime.TryParse(value, out _))
                    errors.Add($"{columnName} 必须是日期格式");
                break;

            case "email":
                if (!value.Contains('@') || !value.Contains('.'))
                    errors.Add($"{columnName} 必须是邮箱格式");
                break;

            default:
                if (rule.MaxLength.HasValue && value.Length > rule.MaxLength.Value)
                {
                    errors.Add($"{columnName} 长度不能超过 {rule.MaxLength.Value} 个字符");
                }
                else if (!string.IsNullOrEmpty(rule.AllowedValues))
                {
                    var allowed = rule.AllowedValues.Split(',').Select(s => s.Trim()).ToList();
                    if (!allowed.Contains(value))
                        errors.Add($"{columnName} 必须是以下值之一：{string.Join(", ", allowed)}");
                }
                break;
        }
    }
}
