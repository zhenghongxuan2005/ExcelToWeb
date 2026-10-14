using System.Text.Json;
using System.Text.Json.Serialization;

namespace ExcelToWeb.Helpers;

/// <summary>
/// 统一把 DateTime 按 UTC 序列化（带 Z 后缀）。
///
/// 背景：落库时间改用 DateTime.UtcNow，但 SQL Server 的 datetime2 不保存时区信息，
/// EF 读回来的 DateTime.Kind 是 Unspecified；若直接序列化就不带 Z，
/// 前端 new Date(...) 会当成本地时间解析，导致展示时间偏差一个时区。
/// 这里把 Unspecified 视为 UTC 并带 Z 输出，前端即可正确转成本地时区显示。
/// </summary>
public class UtcDateTimeJsonConverter : JsonConverter<DateTime>
{
    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var value = reader.GetDateTime();
        return value.Kind == DateTimeKind.Local ? value.ToUniversalTime() : value;
    }

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options)
    {
        var utc = value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
        };
        writer.WriteStringValue(utc);
    }
}
