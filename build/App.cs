using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace HongguoSkin
{
    static class Program
    {
        internal static string AppDir;
        internal static bool Demo;
        internal static bool Fs;
        internal static bool Mini;
        internal static bool Mine;
        internal static bool Ff;
        internal static bool Seq;
        internal static string ViewArg;
        internal static string JumpArg;
        internal static bool Dbg;
        internal static bool Sheet;
        internal static bool Fixed;
        internal static bool VolProbe;
        internal static bool NoHevc;
        internal static bool Moyu;
        internal static bool Mask;
        internal static bool Slow;
        internal static bool Tip;
        internal static string SrcArg;
        internal static bool Fail;
        internal static bool Ach;
        internal static bool Ai;
        internal static bool Sem;
        internal static bool Mem;
        internal static bool NoAsk;
        internal static bool NoTray;
        internal static bool Poke;
        internal static bool MemFile;
        internal static bool NoUpd;
        internal static string AskArg;
        /* 系统版本与本机判定：低于 Win10 时 Weak=true，表示用户明知会挂还要试 */
        internal static double WinVer;
        internal static int WinBuild;
        internal static string OsName;
        internal static bool Weak;
        internal static bool Force;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct OSVER
        {
            public int Size;
            public int Major;
            public int Minor;
            public int Build;
            public int Platform;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
            public string CSD;
            public short SpMajor;
            public short SpMinor;
            public short Suite;
            public byte Product;
            public byte Reserved;
        }

        [DllImport("ntdll.dll", SetLastError = true)]
        private static extern int RtlGetVersion(ref OSVER v);

        /* RtlGetVersion 不受 appcompat 版本谎报影响；未 manifest 的程序走 Environment.OSVersion
           在 Win8 以上会一律报 6.2，所以必须有这条路径 */
        private static void GetWindowsVersion(out double ver, out int build)
        {
            ver = 0; build = 0;
            try
            {
                var v = new OSVER();
                v.Size = Marshal.SizeOf(typeof(OSVER));
                if (RtlGetVersion(ref v) == 0)
                {
                    ver = v.Major + v.Minor / 10.0;
                    build = v.Build;
                    return;
                }
            }
            catch { }
            var e = Environment.OSVersion.Version;
            ver = e.Major + e.Minor / 10.0;
            build = 0;
        }

        private static string WindowsName(double ver, int build)
        {
            if (ver >= 10.0) return build >= 22000 ? "Windows 11" : "Windows 10";
            if (ver >= 6.3) return "Windows 8.1";
            if (ver >= 6.2) return "Windows 8";
            if (ver >= 6.1) return "Windows 7";
            if (ver >= 6.0) return "Windows Vista";
            return "Windows " + ver.ToString("0.0");
        }

        [STAThread]
        static void Main(string[] args)
        {
            Demo = args != null && Array.IndexOf(args, "--demo") >= 0;
            Fs = args != null && Array.IndexOf(args, "--fs") >= 0;
            Mini = args != null && Array.IndexOf(args, "--mini") >= 0;
            Mine = args != null && Array.IndexOf(args, "--mine") >= 0;
            Ff = args != null && Array.IndexOf(args, "--ff") >= 0;
            Seq = args != null && Array.IndexOf(args, "--seq") >= 0;
            Dbg = args != null && Array.IndexOf(args, "--dbg") >= 0;
            Sheet = args != null && Array.IndexOf(args, "--sheet") >= 0;
            Fixed = args != null && Array.IndexOf(args, "--fixed") >= 0;
            VolProbe = args != null && Array.IndexOf(args, "--vol") >= 0;
            NoHevc = args != null && Array.IndexOf(args, "--nohev") >= 0;
            Moyu = args != null && Array.IndexOf(args, "--moyu") >= 0;
            Mask = args != null && Array.IndexOf(args, "--mask") >= 0;
            Slow = args != null && Array.IndexOf(args, "--slow") >= 0;
            Tip = args != null && Array.IndexOf(args, "--tip") >= 0;
            Fail = args != null && Array.IndexOf(args, "--fail") >= 0;
            Ach = args != null && Array.IndexOf(args, "--ach") >= 0;
            Ai = args != null && Array.IndexOf(args, "--ai") >= 0;
            Sem = args != null && Array.IndexOf(args, "--sem") >= 0;
            Mem = args != null && Array.IndexOf(args, "--mem") >= 0;
            NoAsk = args != null && Array.IndexOf(args, "--noa") >= 0;
            NoTray = args != null && Array.IndexOf(args, "--notray") >= 0;
            Poke = args != null && Array.IndexOf(args, "--poke") >= 0;
            MemFile = args != null && Array.IndexOf(args, "--memfile") >= 0;
            NoUpd = args != null && Array.IndexOf(args, "--noupd") >= 0;
            Force = args != null && Array.IndexOf(args, "--force") >= 0;
            if (args != null)
            {
                int ai = Array.IndexOf(args, "--a");
                if (ai >= 0 && ai + 1 < args.Length) AskArg = args[ai + 1];
            }
            if (args != null)
            {
                int si = Array.IndexOf(args, "--src");
                if (si >= 0 && si + 1 < args.Length) SrcArg = args[si + 1];
            }
            if (args != null)
            {
                int vi = Array.IndexOf(args, "--view");
                if (vi >= 0 && vi + 1 < args.Length) ViewArg = args[vi + 1];
            }
            if (args != null)
            {
                /* 联调：--jump <series_id>~<集号>，直接验证"点剧名跳那一集"这条链路 */
                int ji = Array.IndexOf(args, "--jump");
                if (ji >= 0 && ji + 1 < args.Length) JumpArg = args[ji + 1];
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            AppDir = Path.GetDirectoryName(Application.ExecutablePath);
            /* 版本门槛：core 是 Go 1.25 编译的（工具链官方最低要求 Win10），界面内核是 WebView2
               （微软 2023 年 1 月起停止支持 Win7，最后能装的只有 109 版）。Win7 上硬撑的唯一结果
               是 core 起不来，然后弹一句"请查看 app.log"，把问题整个丢给用户。先把话说明白。 */
            GetWindowsVersion(out WinVer, out WinBuild);
            OsName = WindowsName(WinVer, WinBuild);
            /* 硬门槛。Windows 7 上不是"可能失败"，是必然失败，而且零散在启动最前面：
               core 是 Go 1.25 编的，runtime 的信号量走 WaitOnAddress/WakeByAddressSingle，
               这两个是 Win8 才加进 kernel32 的，Go 取到空指针后 call 过去，rip 直接 0x0。
               这种缺失补不了 —— 用户态伪造同步原语没有意义。界面的 WebView2 在 Win7 上也早停了。
               所以这里只给一个说明框和退路，不再给人"试试看"的假希望。 */
            if (WinVer < 10.0 && !Force)
            {
                MessageBox.Show(
                    "这个版本需要 Windows 10 及以上，当前系统是 " + OsName + "，没法启动。\r\n\r\n"
                  + "不是文件坏了，是两套东西都不支持它：\r\n"
                  + "· 内置服务（core）是 Go 1.25 编译的，它的运行时要用 Win8 才加入系统的同步接口，"
                  + "在 " + OsName + " 上取不到入口，一启动就落在空地址上崩溃；\r\n"
                  + "· 界面内核是 WebView2，微软 2023 年 1 月停止支持 Windows 7，最后能装的只有 109 版。\r\n\r\n"
                  + "所以这不是装个运行库、放个 DLL 能补的事，得换台 Windows 10 / 11 的机器。\r\n\r\n"
                  + "如果你就是想自己折腾一次，用命令行带 --force 启动，崩溃全文会写进 app.log。",
                    "红果短剧 · 系统不支持", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            Weak = WinVer < 10.0;
            try
            {
                Application.Run(new MainForm());
            }
            catch (Exception ex)
            {
                MessageBox.Show("启动失败：\r\n" + ex.Message, "红果短剧", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }

    public class MainForm : Form
    {
        private WebView2 web;
        private Process core;
        private string coreUrl;
        private string logPath;
        private bool closing;
        /* 陪伴相关：托盘、到点检查、记忆镜像 */
        private NotifyIcon tray;
        private System.Windows.Forms.Timer pokeTimer;
        private DateTime pokeMutedUntil = DateTime.MinValue;
        private string lastPokeDay = "";
        private string pendingAsk = "";
        private string pendingUrl = "";
        private bool navDone;
        private int? lastCoreExit;
        private bool statusFail;
        private bool coreCrash;
        private readonly Queue<string> coreTail = new Queue<string>();
        private const string UpdateUrl = "https://raw.githubusercontent.com/guhang42-jpg/hongguo-desktop-skin/main/version.json";

        public MainForm()
        {
            logPath = Path.Combine(Program.AppDir, "app.log");
            Text = "红果短剧";
            FormBorderStyle = FormBorderStyle.None;
            BackColor = Color.FromArgb(20, 22, 29);
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(1360, 880);
            MinimumSize = new Size(1000, 680);
            DoubleBuffered = true;
            Opacity = 1.0;
            /* 任务栏/窗口图标：显式取 exe 内嵌图标，避免 WinForms 默认灰底图标 */
            try
            {
                Icon appIco = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (appIco != null) Icon = appIco;
            }
            catch { }

            web = new WebView2();
            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = Color.FromArgb(20, 22, 29);
            Controls.Add(web);

            Load += async (s, e) => await StartAsync();
            FormClosing += OnClosing;
        }

        private void Log(string msg)
        {
            try
            {
                File.AppendAllText(logPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + msg + "\r\n", Encoding.UTF8);
            }
            catch { }
        }

        /* ---------- 官网页片源代理 ----------
         * core 那套 App 取流接口（novel/player/*_video_model）这几天对所有剧一律回 200/0 字节，
         * 皮肤这边能用的只有官网页给普通访问者留的那条兜底：POST /api/video/protected/fallback-play-info
         * 拿一支完整的 360P 明文 MP4（H.264/AAC，90 秒上下，不是 SEO 页那支 10 秒预告）。
         * 官网页不给跨域读，所以在这儿开一个只监听本机回环的小代理，顺手把 CORS 头补上。
         * 端口由系统分配，通过界面 URL 的 &wport= 告诉前端；监听失败就什么都不做，前端会退成报错。 */
        private int webPlayPort;

        private void StartWebPlayProxy()
        {
            try
            {
                /* .NET Framework 4.6.2 默认只开 TLS 1.0/1.1，官网那台只认 1.2；这里显式放开 */
                try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)768 | (SecurityProtocolType)3072; } catch { }
                var listener = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
                listener.Start();
                webPlayPort = ((IPEndPoint)listener.LocalEndpoint).Port;
                Log("官网页片源代理已起 127.0.0.1:" + webPlayPort);
                var th = new Thread(delegate ()
                {
                    while (true)
                    {
                        System.Net.Sockets.TcpClient c;
                        try { c = listener.AcceptTcpClient(); }
                        catch { break; }
                        try { ThreadPool.QueueUserWorkItem(delegate (object o) { ServeWebPlay((System.Net.Sockets.TcpClient)o); }, c); }
                        catch { try { c.Close(); } catch { } }
                    }
                });
                th.IsBackground = true;
                th.Start();
            }
            catch (Exception ex)
            {
                Log("片源代理没起来：" + ex.Message);
                webPlayPort = 0;
            }
        }

        private static string ReadHttpLine(Stream ns)
        {
            var one = new byte[1];
            var sb = new StringBuilder();
            while (true)
            {
                int n;
                try { n = ns.Read(one, 0, 1); } catch { return null; }
                if (n <= 0) return sb.Length > 0 ? sb.ToString() : null;
                if (one[0] == (byte)'\n') break;
                if (one[0] != (byte)'\r') sb.Append((char)one[0]);
                if (sb.Length > 4096) break;
            }
            return sb.ToString();
        }

        private void ServeWebPlay(System.Net.Sockets.TcpClient c)
        {
            int code = 400;
            string body = "{\"ok\":false,\"error\":\"bad_request\"}";
            try
            {
                using (var ns = c.GetStream())
                {
                    ns.ReadTimeout = 8000;
                    var line = ReadHttpLine(ns);
                    string range = null;
                    for (int i = 0; i < 40; i++)
                    {
                        var h = ReadHttpLine(ns);
                        if (h == null || h.Length == 0) break;
                        if (h.StartsWith("Range:", StringComparison.OrdinalIgnoreCase)) range = h.Substring(6).Trim();
                    }
                    string path = "";
                    if (line != null)
                    {
                        int s1 = line.IndexOf(' ');
                        int s2 = s1 >= 0 ? line.IndexOf(' ', s1 + 1) : -1;
                        if (s2 > s1) path = line.Substring(s1 + 1, s2 - s1 - 1);
                    }
                    /* /media?u=<官网 CDN 直链>：那台 CDN 只认官网自己的 Referer，
                       浏览器直接把地址丢给 video 会吃到 403（表现为 error code=4），所以由这儿代拉。 */
                    if (path.StartsWith("/media?u=", StringComparison.Ordinal))
                    {
                        string target = null;
                        try { target = Uri.UnescapeDataString(path.Substring(9)); } catch { target = null; }
                        if (target != null && target.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                        {
                            ServeMedia(ns, target, range);
                            return;
                        }
                        body = "{\"ok\":false,\"error\":\"bad_media_url\"}";
                    }
                    else
                    {
                        string vid = "";
                        int q = path.IndexOf("vid=", StringComparison.OrdinalIgnoreCase);
                        if (q >= 0)
                        {
                            vid = path.Substring(q + 4).Trim();
                            if (Regex.IsMatch(vid, "^\\d{1,30}$"))
                            {
                                string got = FetchWebPlayUrl(vid);
                                if (got != null) { body = got; code = 200; }
                                else { body = "{\"ok\":false,\"error\":\"no_public_source\"}"; code = 404; }
                            }
                        }
                    }
                    var bytes = Encoding.UTF8.GetBytes(body);
                    var head = new StringBuilder();
                    head.Append("HTTP/1.1 " + code + (code == 200 ? " OK" : " ERROR") + "\r\n");
                    head.Append("Content-Type: application/json; charset=utf-8\r\n");
                    head.Append("Access-Control-Allow-Origin: *\r\n");
                    head.Append("Cache-Control: no-store\r\n");
                    head.Append("Content-Length: " + bytes.Length + "\r\n");
                    head.Append("Connection: close\r\n\r\n");
                    var hb = Encoding.UTF8.GetBytes(head.ToString());
                    ns.Write(hb, 0, hb.Length);
                    ns.Write(bytes, 0, bytes.Length);
                    ns.Flush();
                }
            }
            catch (Exception ex) { Log("片源代理请求出错：" + ex.Message); }
            finally { try { c.Close(); } catch { } }
        }

        /* 媒体转发：Range 原样透传（拖进度条要能跳），Referer 换成官网自己的 */
        private void ServeMedia(Stream ns, string target, string range)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(target);
                req.Method = "GET";
                req.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
                req.Referer = "https://hongguoduanju.com/";
                req.Timeout = 15000;
                req.ReadWriteTimeout = 30000;
                if (!string.IsNullOrEmpty(range)) { try { req.Headers["Range"] = range; } catch { } }
                using (var resp = (HttpWebResponse)req.GetResponse())
                {
                    var sb = new StringBuilder();
                    sb.Append("HTTP/1.1 " + (int)resp.StatusCode + " " + resp.StatusDescription + "\r\n");
                    sb.Append("Content-Type: " + (resp.ContentType ?? "video/mp4") + "\r\n");
                    var ar = resp.Headers["Accept-Ranges"];
                    if (ar != null) sb.Append("Accept-Ranges: " + ar + "\r\n");
                    var cr = resp.Headers["Content-Range"];
                    if (cr != null) sb.Append("Content-Range: " + cr + "\r\n");
                    if (resp.ContentLength > 0) sb.Append("Content-Length: " + resp.ContentLength + "\r\n");
                    sb.Append("Access-Control-Allow-Origin: *\r\n");
                    sb.Append("Cache-Control: no-store\r\n");
                    sb.Append("Connection: close\r\n\r\n");
                    var hb = Encoding.UTF8.GetBytes(sb.ToString());
                    ns.Write(hb, 0, hb.Length);
                    var src = resp.GetResponseStream();
                    var buf = new byte[65536];
                    int n;
                    while ((n = src.Read(buf, 0, buf.Length)) > 0)
                    {
                        ns.Write(buf, 0, n);
                        ns.Flush();
                    }
                }
            }
            catch (Exception ex) { Log("媒体转发出错：" + ex.Message); }
        }

        /* 官网那条兜底接口：body 只认顶层的 item_id（写成 vid 会被回 400 public_fallback_unavailable） */
        private string FetchWebPlayUrl(string vid)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("https://hongguoduanju.com/api/video/protected/fallback-play-info");
                req.Method = "POST";
                req.ContentType = "application/json; charset=utf-8";
                req.Accept = "application/json";
                req.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
                req.Referer = "https://hongguoduanju.com/";
                req.Timeout = 9000;
                req.ReadWriteTimeout = 9000;
                var post = Encoding.UTF8.GetBytes("{\"item_id\":\"" + vid + "\"}");
                req.ContentLength = post.Length;
                using (var s = req.GetRequestStream()) { s.Write(post, 0, post.Length); }
                string json;
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    json = sr.ReadToEnd();
                var mu = Regex.Match(json, "\"main_url\"\\s*:\\s*\"([^\"]+)\"");
                if (!mu.Success) { Log("官网页片源返回里没有 main_url"); return null; }
                var url = mu.Groups[1].Value.Replace("\\/", "/").Replace("\\u0026", "&").Replace("\\u003d", "=");
                var me = Regex.Match(json, "\"url_expire\"\\s*:\\s*(\\d+)");
                long exp = me.Success ? long.Parse(me.Groups[1].Value) : 0;
                return "{\"ok\":true,\"url\":\"" + url.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\",\"expire\":" + exp + "}";
            }
            catch (Exception ex)
            {
                Log("官网页片源没拿到：" + ex.Message);
                return null;
            }
        }

        private async Task StartAsync()
        {
            Log("窗口已创建  " + Program.OsName + " " + Program.WinVer.ToString("0.0") + " build=" + Program.WinBuild + (Program.Weak ? "（低于 Win10，用户选择强行尝试）" : ""));
            /* 固定监听端口：WebView2 的 localStorage 是按 origin 隔离的，端口一变就等于换了存储，
               续播点/音量/倍速/榜单名次这些"本地记忆"就全丢。18797 足够偏，撞上官方 8797 的概率极低；
               真被占用就回退到让 core 自己挑端口（这时只丢本地记忆，功能不受影响）。 */
            bool started;
            if (Program.Weak)
            {
                /* 老系统只试一次、只等 8 秒：救不回来的概率最高，就别让人干等三遍 */
                Log("老系统强上：自动端口，单次 8 秒");
                started = await StartCoreAsync(false, 8000);
            }
            else
            {
                started = await StartCoreAsync(true, 9000);
                if (!started)
                {
                    Log("固定端口启动失败，改用自动端口重试");
                    await Task.Delay(1200);
                    started = await StartCoreAsync(false, 9000);
                }
                if (!started)
                {
                    Log("首次启动失败，重试一次");
                    await Task.Delay(1200);
                    started = await StartCoreAsync(false, 9000);
                }
            }
            if (!started)
            {
                FailBox();
                Close();
                return;
            }
            Log("core 就绪: " + coreUrl);

            try
            {
                string dataDir = Path.Combine(Program.AppDir, "webview2");
                Directory.CreateDirectory(dataDir);
                /* 显式打开 Chromium 的"用系统解码器播 HEVC"开关：
                   有些机器明明装了 HEVC 扩展，但内核没启用平台解码，表现就是有声音没画面。 */
                var envOpts = new CoreWebView2EnvironmentOptions
                {
                    AdditionalBrowserArguments = "--enable-features=PlatformHEVCDecoderSupport --autoplay-policy=no-user-gesture-required"
                };
                var env = await CoreWebView2Environment.CreateAsync(null, dataDir, envOpts);
                await web.EnsureCoreWebView2Async(env);
                var settings = web.CoreWebView2.Settings;
                settings.AreDefaultContextMenusEnabled = false;
                settings.IsStatusBarEnabled = false;
                settings.UserAgent = settings.UserAgent + " HongguoSkin/1.0";

                web.CoreWebView2.WebResourceRequested += OnWebResourceRequested;
                web.CoreWebView2.AddWebResourceRequestedFilter(coreUrl + "/skin/*", CoreWebView2WebResourceContext.All);
                web.CoreWebView2.WebMessageReceived += OnWebMessage;
                web.CoreWebView2.ProcessFailed += (s, e) => Log("webview 进程异常: " + e.ProcessFailedKind);
                web.CoreWebView2.NavigationCompleted += async (s, e) =>
                {
                    if (navDone) return;
                    navDone = true;
                    await Task.Delay(1500);
                    PushMemRestore();
                };

                Log("打开界面");
                StartWebPlayProxy();
                string extra = "";
                if (Program.Demo) extra += "?demo=1";
                else extra += "?launch=1";
                if (Program.Mini) extra += "&mini=1";
                if (Program.Fs) extra += "&fs=1";
                if (Program.Mine) extra += "&mine=1";
                if (Program.Ff) extra += "&ff=1";
                if (Program.Seq) extra += "&seq=1";
                if (Program.ViewArg != null) extra += "&view=" + Program.ViewArg;
                if (Program.Sheet) extra += "&sheet=1";
                if (Program.Fixed) extra += "&fixed=1";
                if (Program.VolProbe) extra += "&vol=1";
                if (Program.NoHevc) extra += "&nohev=1";
                if (Program.Moyu) extra += "&moyu=1";
                if (Program.Mask) extra += "&mask=1";
                if (Program.Slow) extra += "&slow=1";
                if (Program.Tip) extra += "&tip=1";
                if (Program.SrcArg != null) extra += "&src=" + Program.SrcArg;
                if (Program.Fail) extra += "&fail=1";
                if (Program.Ach) extra += "&ach=1";
                if (Program.Ai) extra += "&ai=1";
                if (Program.Sem) extra += "&sem=1";
                if (Program.Mem) extra += "&mem=old";
                if (Program.NoAsk) extra += "&noa=1";
                if (Program.MemFile) extra += "&memfile=1";
                if (Program.AskArg != null) extra += "&a=" + Uri.EscapeDataString(Program.AskArg);
                if (Program.JumpArg != null) extra += "&jump=" + Uri.EscapeDataString(Program.JumpArg);
                if (webPlayPort > 0) extra += "&wport=" + webPlayPort;
                if (Program.Dbg) extra += "&dbg=1";
                web.CoreWebView2.Navigate(coreUrl + "/skin/index.html" + extra);
                /* 托盘与"到点看一眼"：界面起来了才有意义，放这儿建 */
                if (!Program.NoTray)
                {
                    SetupTray();
                    SetupPoke();
                    if (Program.Poke) { await Task.Delay(2600); Log("--poke 强制走一次"); PokeTick(true); }
                }
                if (!Program.NoUpd)
                {
                    /* 版本推送：起来 12 秒后去 main 分支拿一个 version.json，几 KB，静默失败。
                       这是本程序唯一的外连，专为"告诉你出新版了"，不涉及任何本机数据。 */
                    Task.Run(async delegate { await Task.Delay(12000); CheckUpdate(false); });
                }
            }
            catch (Exception ex)
            {
                Log("WebView2 初始化失败: " + ex);
                MessageBox.Show("WebView2 运行时初始化失败：\r\n" + ex.Message, "红果短剧", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        }

        private void FailBox()
        {
            string why;
            if (coreCrash)
            {
                why = "core 一启动就崩了"
                    + (lastCoreExit.HasValue ? "（退出码 0x" + ((uint)lastCoreExit.Value).ToString("X8") + "）" : "")
                    + "：它调用了一个这台机器上没有的函数，跳到了空地址（PC=0x0，入口在 runtime.asmstdcall）";
                if (Program.WinVer < 10.0)
                    why += "。这是 " + Program.OsName + " 的系统太旧，Go 运行时需要的同步接口 Win8 才加入，补 DLL 补不出来";
            }
            else if (lastCoreExit.HasValue)
            {
                string hex = "0x" + ((uint)lastCoreExit.Value).ToString("X8");
                why = "core 启动后退出了，退出码 " + hex + " —— " + ExplainExit(lastCoreExit.Value);
            }
            else if (statusFail)
            {
                why = "core 报了端口，但 /api/v1/status 一直没响应";
            }
            else
            {
                why = "core 进程还活着，但一直没报出监听端口";
            }
            Log("判定失败：" + why);
            string tail = "";
            if (coreTail.Count > 0)
            {
                var lines = new List<string>(coreTail);
                tail = "core 最后几行：\r\n" + string.Join("\r\n", lines.ToArray()).Trim() + "\r\n\r\n";
            }
            var r = MessageBox.Show(
                "内置服务没有启动起来，界面打不开。\r\n\r\n"
              + "系统：" + Program.OsName + " " + Program.WinVer.ToString("0.0") + "\r\n"
              + "原因：" + why + "\r\n\r\n"
              + tail
              + (Program.WinVer < 10.0
                    ? "Windows 7 上跑不起来是正常的：core 要 Go 1.25（官方最低 Win10），界面要 WebView2（微软 2023 年 1 月起停止支持，最后只有 109 版）。\r\n\r\n"
                    : "")
              + "完整日志：" + logPath + "\r\n\r\n"
              + "点「确定」用记事本打开它；点「取消」直接关掉。",
                "红果短剧", MessageBoxButtons.OKCancel, MessageBoxIcon.Error);
            if (r == DialogResult.OK)
            {
                try { Process.Start("notepad.exe", "\"" + logPath + "\""); } catch { }
            }
        }

        /* 把退出码翻成人话，省得每次都去翻微软文档 */
        private static string ExplainExit(int code)
        {
            switch ((uint)code)
            {
                case 0xC0000135u: return "找不到它依赖的 DLL";
                case 0xC0000139u: return "DLL 里缺入口点，一般是系统版本太旧";
                case 0xC000007Bu: return "位数不对，或者哪个 DLL 是坏文件";
                case 0xC0000142u: return "DLL 初始化失败";
                case 0xC0000005u: return "访问了不该访问的内存（程序自身崩了）";
                case 0xC000001Du: return "执行了这台 CPU 不认识的指令";
                case 0xC0000409u: return "程序自己触发了缓冲区安全检查";
                case 0x80070005u: return "系统拒绝执行，可能是杀毒软件拦住了";
                case 0x8007007Eu: return "文件名或路径有问题";
                default: return "退出码原样贴给开发者更快";
            }
        }

        private async Task<bool> StartCoreAsync(bool fixedPort, int waitMs)
        {
            string coreExe = Path.Combine(Program.AppDir, "core", "hongguo-tv-core.exe");
            if (!File.Exists(coreExe))
            {
                Log("找不到 core: " + coreExe);
                return false;
            }

            KillOwnCores();

            var psi = new ProcessStartInfo(coreExe)
            {
                WorkingDirectory = Path.Combine(Program.AppDir, "core"),
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };
            if (fixedPort) psi.Arguments = "-port 18797";
            coreTail.Clear();
            lastCoreExit = null;
            statusFail = false;
            coreCrash = false;
            string dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "HonggoDesktop");
            psi.EnvironmentVariables["HONGGUO_TV_DATA_DIR"] = dataDir;

            var ready = new TaskCompletionSource<string>();
            core = new Process { StartInfo = psi };
            core.OutputDataReceived += (s, e) => Scan(e.Data, ready);
            core.ErrorDataReceived += (s, e) => Scan(e.Data, ready);
            core.Exited += (s, e) =>
            {
                if (!closing)
                {
                    int code = 0;
                    try { code = core.ExitCode; } catch { }
                    lastCoreExit = code;
                    Log("core 进程退出，代码 " + code + " (0x" + ((uint)code).ToString("X8") + ") " + ExplainExit(code));
                    ready.TrySetResult("");
                }
            };
            core.EnableRaisingEvents = true;

            try { core.Start(); }
            catch (Exception ex) { Log("core 启动失败: " + ex.Message); return false; }
            core.BeginOutputReadLine();
            core.BeginErrorReadLine();
            Log("core 已启动 pid=" + core.Id + " data=" + dataDir);

            string port = null;
            try
            {
                var task = ready.Task;
                if (await Task.WhenAny(task, Task.Delay(waitMs)) == task) port = task.Result;
            }
            catch { }

            if (string.IsNullOrEmpty(port))
            {
                Log("没等到端口");
                try { if (core != null && !core.HasExited) core.Kill(); } catch { }
                return false;
            }
            coreUrl = "http://127.0.0.1:" + port;

            for (int i = 0; i < 12; i++)
            {
                try
                {
                    using (var wc = new WebClient())
                    {
                        wc.Encoding = Encoding.UTF8;
                        wc.Headers["User-Agent"] = "HongguoSkin/1.0";
                        wc.DownloadString(coreUrl + "/api/v1/status");
                        return true;
                    }
                }
                catch { Thread.Sleep(700); }
            }
            Log("端口有了但 /api/v1/status 不通: " + coreUrl + "（试了 12 次，每次 700ms）");
            statusFail = true;
            return false;
        }

        // 只清理本皮肤自带目录里的 core，绝不动用户原版 App 的 core
        private void KillOwnCores()
        {
            string mine = Path.Combine(Program.AppDir, "core", "hongguo-tv-core.exe");
            foreach (var p in Process.GetProcessesByName("hongguo-tv-core"))
            {
                try
                {
                    string path = p.MainModule.FileName;
                    if (string.Equals(path, mine, StringComparison.OrdinalIgnoreCase))
                    {
                        Log("清理上次残留 core pid=" + p.Id);
                        p.Kill();
                    }
                }
                catch { }
            }
            Thread.Sleep(400);
        }

        private void Scan(string line, TaskCompletionSource<string> ready)
        {
            if (string.IsNullOrEmpty(line) || ready.Task.IsCompleted) return;
            Log("[core] " + line);
            /* Go 崩溃时 PC=0x0 且落在 runtime.asmstdcall：说明它调的系统函数里有个空指针，
               基本就是系统版本太旧、那个入口不存在。这一条能直接把病因说清，不用人看寄存器。 */
            if (line.IndexOf("PC=0x0", StringComparison.Ordinal) >= 0 || line.IndexOf("asmstdcall", StringComparison.Ordinal) >= 0)
                coreCrash = true;
            /* 留最后 6 行：core 自己说的错，比我们猜准得多 */
            if (coreTail.Count >= 6) coreTail.Dequeue();
            coreTail.Enqueue(line.Length > 120 ? line.Substring(0, 120) + "…" : line);
            var m = Regex.Match(line, @"listening on 127\.0\.0\.1:(\d+)");
            if (m.Success) ready.TrySetResult(m.Groups[1].Value);
        }

        private void OnWebResourceRequested(object sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            try
            {
                var uri = new Uri(e.Request.Uri);
                string path = uri.AbsolutePath;
                if (!path.StartsWith("/skin/")) return;

                string rel = path.Substring("/skin/".Length);
                if (rel.Length == 0) rel = "index.html";
                rel = Uri.UnescapeDataString(rel).Replace('/', '\\');
                string file = Path.Combine(Program.AppDir, "ui", rel);

                if (!File.Exists(file))
                {
                    e.Response = web.CoreWebView2.Environment.CreateWebResourceResponse(
                        new MemoryStream(Encoding.UTF8.GetBytes("not found: " + rel)), 404, "Not Found",
                        "Content-Type: text/plain; charset=utf-8");
                    return;
                }

                byte[] bytes = File.ReadAllBytes(file);
                string ctype = ContentTypeFor(Path.GetExtension(file).ToLowerInvariant());
                string headers = "Content-Type: " + ctype + "\r\nCache-Control: no-store\r\n";
                e.Response = web.CoreWebView2.Environment.CreateWebResourceResponse(
                    new MemoryStream(bytes), 200, "OK", headers);
            }
            catch (Exception ex)
            {
                Log("静态资源出错: " + ex.Message);
            }
        }

        private static string ContentTypeFor(string ext)
        {
            switch (ext)
            {
                case ".html": return "text/html; charset=utf-8";
                case ".js": return "application/javascript; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".json": return "application/json; charset=utf-8";
                case ".svg": return "image/svg+xml";
                case ".png": return "image/png";
                case ".jpg":
                case ".jpeg": return "image/jpeg";
                case ".webp": return "image/webp";
                case ".ico": return "image/x-icon";
                case ".woff2": return "font/woff2";
                case ".ttf": return "font/ttf";
                case ".wasm": return "application/wasm";
                case ".mjs": return "application/javascript; charset=utf-8";
                case ".onnx": return "application/octet-stream";
                case ".bin": return "application/octet-stream";
                default: return "application/octet-stream";
            }
        }

        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                string msg;
                try { msg = e.TryGetWebMessageAsString(); } catch { msg = null; }
                if (msg == null) msg = e.WebMessageAsJson;
                Log("[ui] " + (msg.Length > 160 ? msg.Substring(0, 160) + " …(" + msg.Length + " 字节)" : msg));
                var am = Regex.Match(msg, "\"action\"\\s*:\\s*\"([a-zA-Z]+)\"");
                string action = am.Success ? am.Groups[1].Value : "";
                switch (action)
                {
                    case "min": WindowState = FormWindowState.Minimized; return;
                    case "max":
                        WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
                        ApplyCorners();
                        return;
                    case "close": Close(); return;
                    case "hover":
                        {
                            var hm = Regex.Match(msg, "\"on\"\\s*:\\s*(true|false)");
                            bool on = hm.Success && hm.Groups[1].Value == "true";
                            if (isMini) Opacity = on ? 1.0 : 0.94;
                            return;
                        }
                    case "alpha":
                        {
                            var am2 = Regex.Match(msg, "\"value\"\\s*:\\s*(\\d+)");
                            if (am2.Success) Opacity = Math.Max(0.55, Math.Min(1.0, int.Parse(am2.Groups[1].Value) / 100.0));
                            return;
                        }
                    case "miniSize":
                        {
                            /* 小窗的窗口尺寸跟着片源比例走：横屏就矮一点、竖屏就高一截，
                               免得固定 430x780 把 16:9 的画面裁成一条竖缝 */
                            var wm = Regex.Match(msg, "\"h\"\\s*:\\s*(\\d+)");
                            var vw = Regex.Match(msg, "\"w\"\\s*:\\s*(\\d+)");
                            if (wm.Success && isMini)
                            {
                                var wa2 = Screen.FromControl(this).WorkingArea;
                                int h = Math.Max(140, Math.Min(wa2.Height - 8, int.Parse(wm.Groups[1].Value)));
                                int w = vw.Success ? Math.Max(240, Math.Min(wa2.Width - 8, int.Parse(vw.Groups[1].Value))) : Bounds.Width;
                                var r = Bounds;
                                Bounds = new Rectangle(wa2.Right - w - 18, r.Bottom - h, w, h);
                                Log("小窗适配画面 " + w + "x" + h);
                            }
                            return;
                        }
                    case "drag": ReleaseCapture(); SendMessage(Handle, 0xA1, 0x2, 0); return;
                    case "fs":
                        {
                            var om = Regex.Match(msg, "\"on\"\\s*:\\s*(true|false)");
                            bool on = om.Success && om.Groups[1].Value == "true";
                            SetFullScreen(on);
                            return;
                        }
                    case "mini":
                        {
                            var om2 = Regex.Match(msg, "\"on\"\\s*:\\s*(true|false)");
                            SetMiniMode(om2.Success && om2.Groups[1].Value == "true");
                            return;
                        }
                    /* 摸鱼：标题也换成 Excel，任务栏扫一眼看不出破绽 */
                    case "moyu":
                        {
                            var mm = Regex.Match(msg, "\"on\"\\s*:\\s*(true|false)");
                            isMoyu = mm.Success && mm.Groups[1].Value == "true";
                            Text = isMoyu ? "Microsoft Excel - 2026年度费用统计.xlsx" : "红果短剧";
                            return;
                        }
                    /* 缺 HEVC 解码器时，界面上的按钮点这里，直接拉商店的扩展页 */
                    case "openStore":
                        try { Process.Start(new ProcessStartInfo("ms-windows-store://pdp/?ProductId=9n4wgh0z6vhq") { UseShellExecute = true }); }
                        catch (Exception ex) { Log("打开商店失败: " + ex.Message); }
                        return;
                    /* 装完扩展需要重启应用（解码器是进程启动时加载的），这里代用户重启 */
                    case "relaunch":
                        try
                        {
                            closing = true;
                            Process.Start(new ProcessStartInfo(Application.ExecutablePath) { UseShellExecute = true, WorkingDirectory = Program.AppDir });
                            Close();
                        }
                        catch (Exception ex) { Log("重启失败: " + ex.Message); }
                        return;
                    /* 记忆镜像：前端把整块记忆 + 一份可读的 Markdown 发过来，落到 %APPDATA%\HonggoDesktop */
                    case "mem":
                        {
                            var jm = Regex.Match(msg, "\"j\"\\s*:\\s*\"([A-Za-z0-9+/=]+)\"");
                            var mm = Regex.Match(msg, "\"m\"\\s*:\\s*\"([A-Za-z0-9+/=]+)\"");
                            if (jm.Success)
                            {
                                SaveMem(B64Dec(jm.Groups[1].Value), mm.Success ? B64Dec(mm.Groups[1].Value) : "");
                            }
                            return;
                        }
                    /* 只放行 GitHub 的 https 链接，别让界面借我的手开任意程序 */
                    case "openUrl":
                        {
                            var um = Regex.Match(msg, "\"url\"\\s*:\\s*\"([^\"]+)\"");
                            if (um.Success) OpenUrl(um.Groups[1].Value);
                            return;
                        }
                    default: return;
                }
            }
            catch { }
        }

        /* ========= 小果的记忆文件 / 陪伴 ========= */

        private string MemDir()
        {
            string d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "HonggoDesktop");
            try { Directory.CreateDirectory(d); } catch { }
            return d;
        }
        private string MemJsonPath() { return Path.Combine(MemDir(), "xiaoguo-memory.json"); }
        private string MemMdPath() { return Path.Combine(MemDir(), "xiaoguo-memory.md"); }

        private static string B64Dec(string s)
        {
            try { return Encoding.UTF8.GetString(Convert.FromBase64String(s)); } catch { return ""; }
        }

        private void SaveMem(string json, string md)
        {
            if (string.IsNullOrEmpty(json)) return;
            try { File.WriteAllText(MemJsonPath(), json, new UTF8Encoding(false)); }
            catch (Exception ex) { Log("写记忆 json 失败: " + ex.Message); }
            if (string.IsNullOrEmpty(md)) return;
            try { File.WriteAllText(MemMdPath(), md, new UTF8Encoding(false)); }
            catch (Exception ex) { Log("写记忆 md 失败: " + ex.Message); }
        }

        private string ReadMemJson()
        {
            try
            {
                string p = MemJsonPath();
                if (!File.Exists(p)) return null;
                var fi = new FileInfo(p);
                if (fi.Length > 262144) return null;
                return File.ReadAllText(p, Encoding.UTF8);
            }
            catch { return null; }
        }

        /* 启动时把文件里的记忆推回去：前端只有在本地存储是空的时候才认它，绝不覆盖在用的记忆 */
        private void PushMemRestore()
        {
            try
            {
                string json = ReadMemJson();
                if (json == null || web == null || web.CoreWebView2 == null) return;
                string b = Convert.ToBase64String(Encoding.UTF8.GetBytes(json));
                web.CoreWebView2.PostWebMessageAsJson("{\"action\":\"memRestore\",\"j\":\"" + b + "\"}");
                Log("记忆兜底：把文件推给前端，共 " + json.Length + " 字节");
            }
            catch (Exception ex) { Log("推记忆失败: " + ex.Message); }
        }

        private void SetupTray()
        {
            try
            {
                tray = new NotifyIcon();
                Icon ico = null;
                try { ico = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
                tray.Icon = ico != null ? ico : SystemIcons.Application;
                tray.Text = "红果短剧 · 小果在旁边";

                var menu = new ContextMenuStrip();
                menu.Items.Add("打开小果", null, new EventHandler(delegate { ShowMain(); OpenAi(""); }));
                menu.Items.Add("随便挑一部", null, new EventHandler(delegate { ShowMain(); OpenAi("推荐一部"); }));
                menu.Items.Add("检查更新", null, new EventHandler(delegate { ShowMain(); CheckUpdate(true); }));
                menu.Items.Add("今天别打扰我", null, new EventHandler(delegate
                {
                    /* 关掉主动出声只到明天 8 点，第二天照旧 —— 免得一次手滑变成永久失联 */
                    pokeMutedUntil = DateTime.Today.AddDays(1).AddHours(8);
                    Log("手动静音到 " + pokeMutedUntil);
                    if (tray != null) tray.ShowBalloonTip(4000, "小果", "行，今天不吭声了。想看的时候点我一下。", ToolTipIcon.None);
                }));
                menu.Items.Add(new ToolStripSeparator());
                menu.Items.Add("退出", null, new EventHandler(delegate { closing = true; Close(); }));
                tray.ContextMenuStrip = menu;
                tray.DoubleClick += new EventHandler(delegate { ShowMain(); });
                tray.BalloonTipClicked += new EventHandler(delegate
                {
                    if (pendingUrl.Length > 0)
                    {
                        string u = pendingUrl; pendingUrl = "";
                        OpenUrl(u);
                        return;
                    }
                    ShowMain(); OpenAi(pendingAsk);
                });
                tray.Visible = true;
                Log("托盘就位");
            }
            catch (Exception ex) { Log("托盘创建失败: " + ex.Message); }
        }

        private void SetupPoke()
        {
            /* 到点看一眼：每 45 分钟醒一次，只比较内存里的几个时间戳，
               不截屏、不联网、不碰模型 —— 醒完就睡。一天最多说一句。 */
            try
            {
                pokeTimer = new System.Windows.Forms.Timer();
                pokeTimer.Interval = 45 * 60 * 1000;
                pokeTimer.Tick += new EventHandler(delegate { PokeTick(); });
                pokeTimer.Start();
                Log("到点检查已开：45 分钟一次，8:00–22:00，一天最多一句");
            }
            catch (Exception ex) { Log("定时器失败: " + ex.Message); }
        }

        private void ShowMain()
        {
            try
            {
                if (!Visible) Show();
                if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
                Activate();
                BringToFront();
            }
            catch { }
        }

        private void OpenAi(string ask)
        {
            try
            {
                if (web == null || web.CoreWebView2 == null) return;
                web.CoreWebView2.PostWebMessageAsJson("{\"action\":\"aiOpen\"}");
                if (!string.IsNullOrEmpty(ask))
                {
                    string q = ask.Replace("\\", "\\\\").Replace("\"", "\\\"");
                    web.CoreWebView2.PostWebMessageAsJson("{\"action\":\"aiAsk\",\"text\":\"" + q + "\"}");
                }
            }
            catch { }
        }

        private static string JStr(string json, string key)
        {
            var m = Regex.Match(json, "\"" + key + "\"\\s*:\\s*\"([^\"]*)\"");
            return m.Success ? m.Groups[1].Value : "";
        }
        private static long JNum(string json, string key)
        {
            var m = Regex.Match(json, "\"?" + key + "\"?\\s*:\\s*(\\d+)");
            if (!m.Success) return 0;
            try { return long.Parse(m.Groups[1].Value); } catch { return 0; }
        }

        /* 从记忆里挑一条正向偏好当话头：否定的（不喜欢 / 不看…）不当种子 */
        private static string FirstPref(string json)
        {
            var blk = Regex.Match(json, "\"facts\"\\s*:\\s*\\[(.*?)\\]\\s*,\\s*\"asked\"", RegexOptions.Singleline);
            if (!blk.Success) return "";
            foreach (Match f in Regex.Matches(blk.Groups[1].Value, "\"t\"\\s*:\\s*\"([^\"]+)\""))
            {
                string t = f.Groups[1].Value;
                if (t.StartsWith("不喜欢") || t.StartsWith("不看") || t.StartsWith("讨厌") || t.StartsWith("受不了")) continue;
                t = Regex.Replace(t, "(比较|特别|很|最)?(喜欢|爱看|爱追|想看|只看)", "");
                t = Regex.Replace(t, "的$", "");
                if (t.Length >= 2) return t;
            }
            return "";
        }

        private void PokeTick() { PokeTick(false); }

        /* ========= 版本推送 ========= */

        private string LocalVersion()
        {
            try
            {
                string p = Path.Combine(Program.AppDir, "ui", "version.txt");
                if (File.Exists(p))
                {
                    string v = File.ReadAllText(p, Encoding.UTF8).Trim();
                    if (v.Length > 0 && v.Length < 20) return v;
                }
            }
            catch { }
            /* 没有版本号就是没有：返回空串让调用方跳过比对。
               千万别返回 "0.0.0" —— 那样远端任何版本都比它大，每次启动都会提示新版。 */
            return "";
        }

        private static int VerCmp(string a, string b)
        {
            string[] x = a.Split('.'), y = b.Split('.');
            int n = Math.Max(x.Length, y.Length);
            for (int i = 0; i < n; i++)
            {
                int xi = 0, yi = 0;
                if (i < x.Length) int.TryParse(x[i], out xi);
                if (i < y.Length) int.TryParse(y[i], out yi);
                if (xi != yi) return xi > yi ? 1 : -1;
            }
            return 0;
        }

        private void OpenUrl(string url)
        {
            try
            {
                if (string.IsNullOrEmpty(url)) return;
                /* 白名单：GitHub（更新/下载）+ 红果官方站（片源被官方抽空时，界面给一条能顶上的路） */
                if (!url.StartsWith("https://github.com/") && !url.StartsWith("https://hongguoduanju.com/"))
                {
                    Log("拒绝打开非白名单链接: " + url);
                    return;
                }
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                Log("打开链接 " + url);
            }
            catch (Exception ex) { Log("打开链接失败: " + ex.Message); }
        }

        /* 提示过一次的版本号记在这，下次启动不再重复喊同一个版本。
           只在"有新版本但还没更新"的期间起作用（一更新版本号自然对不上）。 */
        private string UpdSeenPath() { return Path.Combine(MemDir(), "update-seen.txt"); }

        private string UpdSeen()
        {
            try
            {
                string p = UpdSeenPath();
                if (File.Exists(p)) return File.ReadAllText(p, Encoding.UTF8).Trim();
            }
            catch { }
            return "";
        }

        private void MarkUpdSeen(string v)
        {
            try { File.WriteAllText(UpdSeenPath(), v, new UTF8Encoding(false)); }
            catch (Exception ex) { Log("记更新提示失败: " + ex.Message); }
        }

        private void NotifyUpdate(string v, string notes, string url, bool manual)
        {
            try
            {
                /* 气泡/胶囊里塞不下换行，先压成一行，免得拼出来的 JSON 破掉 */
                notes = (notes ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
                /* 手动点「检查更新」时窗口已经被唤起来了，胶囊够用，不再多弹一个气泡 */
                if (tray != null && !manual)
                {
                    pendingAsk = "";
                    string tip = notes.Length > 0 ? notes : "点这里去看看";
                    tray.ShowBalloonTip(9000, "有新版本 v" + v, tip + "（点这里打开）", ToolTipIcon.None);
                }
                if (web != null && web.CoreWebView2 != null)
                {
                    string n = notes.Replace("\\", "\\\\").Replace("\"", "\\\"");
                    string u = url.Replace("\\", "\\\\").Replace("\"", "\\\"");
                    web.CoreWebView2.PostWebMessageAsJson("{\"action\":\"update\",\"v\":\"" + v + "\",\"url\":\"" + u + "\",\"notes\":\"" + n + "\",\"manual\":" + (manual ? "true" : "false") + "}");
                }
            }
            catch (Exception ex) { Log("弹更新提示失败: " + ex.Message); }
        }

        private string FetchVerJson(bool useProxy)
        {
            using (var wc = new WebClient())
            {
                wc.Encoding = Encoding.UTF8;
                string v = LocalVersion();
                wc.Headers["User-Agent"] = "HongguoSkin/" + (v.Length > 0 ? v : "unknown");
                if (!useProxy) wc.Proxy = null;
                return wc.DownloadString(UpdateUrl);
            }
        }

        private void CheckUpdate(bool manual)
        {
            Task.Run(async delegate
            {
                string local = LocalVersion();
                if (local.Length == 0)
                {
                    Log("没有 ui/version.txt，跳过更新检查");
                    if (manual) SayOnTray("检查更新", "包里没有版本号文件，这台机器上是旧包？");
                    return;
                }
                Log("检查更新（当前 " + local + (manual ? "，手动" : "") + "）");
                try
                {
                    /* .NET Framework 的 WebClient 默认可能只到 TLS 1.0，raw.githubusercontent.com 只收 1.2+，
                       先把协议抬上去，否则连不上还看不出原因 */
                    try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)768 | (SecurityProtocolType)3072; } catch { }
                    string body = null, err = null;
                    Task fetch = Task.Run(delegate
                    {
                        try { body = FetchVerJson(true); }
                        catch (Exception e1)
                        {
                            err = e1.Message;
                            try { body = FetchVerJson(false); err = null; }   /* 系统代理不通就绕开直连再试一次 */
                            catch (Exception e2) { err = e1.Message + " / 直连: " + e2.Message; }
                        }
                    });
                    if (await Task.WhenAny(fetch, Task.Delay(12000)) != fetch)
                    {
                        Log("检查更新超时（网络或代理不通）");
                        if (manual) SayOnTray("检查更新", "连不上，网络或代理的问题。");
                        return;
                    }
                    if (body == null)
                    {
                        Log("检查更新拿不到内容：" + (err == null ? "空响应" : err));
                        if (manual) SayOnTray("检查更新", "没连上，网络或代理不通。");
                        return;
                    }
                    string remote = JStr(body, "version"), url = JStr(body, "url"), notes = JStr(body, "notes");
                    if (string.IsNullOrEmpty(remote)) { Log("version.json 里没读到版本号"); return; }
                    if (VerCmp(remote, local) > 0)
                    {
                        pendingUrl = url;
                        Log("发现新版本 " + remote + "（当前 " + local + "）");
                        try
                        {
                            BeginInvoke(new Action(delegate
                            {
                                /* 看片 / 摸鱼的时候不弹，也别把 pendingUrl 留着 —— 免得之后点别的气泡被这套地址劫走 */
                                if (isMoyu || isFs)
                                {
                                    pendingUrl = "";
                                    Log("正在" + (isMoyu ? "摸鱼" : "看片") + "，这次不打扰，下次启动再说");
                                    return;
                                }
                                /* 同一个版本只喊一次，别每次开机都来一遍（手动点的不算） */
                                if (!manual && UpdSeen() == remote)
                                {
                                    pendingUrl = "";
                                    Log("v" + remote + " 已经提示过，不再重复");
                                    return;
                                }
                                NotifyUpdate(remote, notes, url, manual);
                                MarkUpdSeen(remote);
                            }));
                        }
                        catch { }
                    }
                    else
                    {
                        Log("已是最新 " + local + (manual ? "（手动检查）" : ""));
                        if (manual) SayOnTray("红果短剧", "已经是最新版 v" + local);
                    }
                }
                catch (Exception ex)
                {
                    Log("检查更新失败: " + ex.Message);
                    if (manual) SayOnTray("检查更新", "没连上：" + ex.Message);
                }
            });
        }

        private void SayOnTray(string title, string body)
        {
            try
            {
                BeginInvoke(new Action(delegate
                {
                    /* 新气泡盖旧语义：旧的待打开链接一律作废，免得点这个气泡开那个页面 */
                    pendingUrl = "";
                    if (tray != null) tray.ShowBalloonTip(5000, title, body, ToolTipIcon.None);
                }));
            }
            catch { }
        }

        private void PokeTick(bool force)
        {
            try
            {
                if (closing || tray == null) return;
                DateTime now = DateTime.Now;
                if (!force)
                {
                    if (now.Hour < 8 || now.Hour >= 22) return;     /* 深夜一句话都不说 */
                    if (now < pokeMutedUntil) return;
                    if (lastPokeDay == now.ToString("yyyy-M-d")) return;
                }
                if (isMoyu || isFs || isMini) return;           /* 摸鱼态、看片中、小窗挂机都不打扰 */
                if (!Visible && WindowState != FormWindowState.Minimized) return;

                string json = ReadMemJson();
                if (json == null) { Log("到点检查：没有记忆文件，跳过"); return; }
                if (!force && JStr(json, "talkDay") == now.ToString("yyyy-M-d")) return;   /* 今天已经聊过，不多嘴 */

                long seenLast = JNum(json, "seenLast");
                long seenN = JNum(json, "seenN");
                int gap = 0;
                if (seenLast > 0)
                {
                    try
                    {
                        DateTime last = DateTimeOffset.FromUnixTimeMilliseconds(seenLast).LocalDateTime;
                        gap = (int)(now.Date - last.Date).TotalDays;
                    }
                    catch { gap = 0; }
                }

                string pref = FirstPref(json);
                string body;
                string ask = "";
                if (gap >= 3)
                {
                    body = "你有 " + gap + " 天没来了。想挑一部看看吗？";
                    ask = "推荐一部";
                }
                else if (pref.Length > 0)
                {
                    body = "你说过爱看「" + pref + "」。我给你挑一部？";
                    ask = "推荐一部";
                }
                else if (seenN > 0)
                {
                    body = "今天还没见你说话。要不要找部短的看看？";
                    ask = "推荐一部";
                }
                else return;

                lastPokeDay = now.ToString("yyyy-M-d");
                pendingAsk = ask;
                tray.ShowBalloonTip(9000, "小果", body, ToolTipIcon.None);
                Log("主动出声: " + body);
            }
            catch (Exception ex) { Log("到点检查出错: " + ex.Message); }
        }

        private Rectangle prevBounds;
        private bool isFs;
        private bool isMini;
        private Rectangle miniPrevBounds;
        private Size miniPrevMin;

        private void SetMiniMode(bool on)
        {
            if (on == isMini) return;
            isMini = on;
            if (on)
            {
                if (isFs) SetFullScreen(false);
                miniPrevBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                miniPrevMin = MinimumSize;
                WindowState = FormWindowState.Normal;
                MinimumSize = new Size(260, 200);
                var wa = Screen.FromControl(this).WorkingArea;
                int w = 430, h = 780;
                if (h > wa.Height - 20) h = wa.Height - 20;
                Bounds = new Rectangle(wa.Right - w - 18, wa.Bottom - h - 18, w, h);
                TopMost = true;
                Opacity = 0.94;
                Log("进入小窗模式 " + Bounds.Width + "x" + Bounds.Height);
            }
            else
            {
                TopMost = false;
                Opacity = 1.0;
                MinimumSize = miniPrevMin;
                WindowState = FormWindowState.Normal;
                if (!miniPrevBounds.IsEmpty) Bounds = miniPrevBounds;
                Log("退出小窗模式");
            }
        }

        private void SetFullScreen(bool on)
        {
            if (on == isFs) return;
            isFs = on;
            if (on)
            {
                bool wasMini = isMini;
                if (wasMini)
                {
                    /* 小窗 → 全屏：先收掉小窗形态，否则窗口尺寸和主界面会互相打架 */
                    isMini = false;
                    TopMost = false;
                    Opacity = 1.0;
                    MinimumSize = miniPrevMin;
                    Log("全屏前退出小窗");
                }
                prevBounds = (wasMini && !miniPrevBounds.IsEmpty)
                    ? miniPrevBounds
                    : (WindowState == FormWindowState.Normal ? Bounds : RestoreBounds);
                WindowState = FormWindowState.Normal;
                TopMost = true;
                Bounds = Screen.FromControl(this).Bounds;
                Log("进入全屏 " + Bounds.Width + "x" + Bounds.Height);
            }
            else
            {
                TopMost = false;
                WindowState = FormWindowState.Normal;
                if (!prevBounds.IsEmpty) Bounds = prevBounds;
                Log("退出全屏");
            }
            ApplyCorners();
        }

        private void ApplyCorners()
        {
            try
            {
                int pref = 1; // DWMWCP_DONOTROUND
                DwmSetWindowAttribute(Handle, 33, ref pref, sizeof(int));
                int border = 0;
                DwmSetWindowAttribute(Handle, 34, ref border, sizeof(int));
            }
            catch { }
        }

        // 无边框窗口：去掉 Win11 默认的大圆角，保持利落的直角
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            ApplyCorners();
            /* 全局热键：就算在别的程序前台按，也能一键把界面收成 Excel（Ctrl+Shift+M） */
            try
            {
                hotOk = RegisterHotKey(Handle, HotId, 0x2 | 0x4, 0x4D);
                Log("摸鱼热键 Ctrl+Shift+M " + (hotOk ? "已注册" : "注册失败（可能被别的程序占用）"));
            }
            catch { }
        }

        private const int HotId = 0xA11;
        private bool hotOk;
        private bool isMoyu;

        // 无边框窗口的四边拖拽缩放
        protected override void WndProc(ref Message m)
        {
            const int WM_NCHITTEST = 0x84;
            const int WM_HOTKEY = 0x312;
            if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HotId)
            {
                /* 把切换交给前端：前端才知道播放要不要暂停、界面怎么盖 */
                try
                {
                    if (web != null && web.CoreWebView2 != null)
                        web.CoreWebView2.PostWebMessageAsJson("{\"action\":\"moyuT\"}");
                }
                catch { }
                return;
            }
            if (m.Msg == WM_NCHITTEST && WindowState == FormWindowState.Normal)
            {
                Point p = PointToClient(new Point(m.LParam.ToInt32() & 0xFFFF, m.LParam.ToInt32() >> 16));
                int b = 6;
                bool left = p.X <= b, right = p.X >= ClientSize.Width - b;
                bool top = p.Y <= b, bottom = p.Y >= ClientSize.Height - b;
                if (top && left) { m.Result = (IntPtr)13; return; }
                if (top && right) { m.Result = (IntPtr)14; return; }
                if (bottom && left) { m.Result = (IntPtr)16; return; }
                if (bottom && right) { m.Result = (IntPtr)17; return; }
                if (left) { m.Result = (IntPtr)10; return; }
                if (right) { m.Result = (IntPtr)11; return; }
                if (top) { m.Result = (IntPtr)12; return; }
                if (bottom) { m.Result = (IntPtr)15; return; }
            }
            base.WndProc(ref m);
        }

        private void OnClosing(object sender, FormClosingEventArgs e)
        {
            Log("窗口关闭: " + e.CloseReason);
            closing = true;
            try { if (pokeTimer != null) { pokeTimer.Stop(); pokeTimer.Dispose(); pokeTimer = null; } } catch { }
            try { if (tray != null) { tray.Visible = false; tray.Dispose(); tray = null; } } catch { }
            try
            {
                if (web != null && web.CoreWebView2 != null) web.CoreWebView2.Stop();
            }
            catch { }
            try
            {
                if (core != null && !core.HasExited)
                {
                    core.Kill();
                    core.WaitForExit(3000);
                }
            }
            catch { }
            Log("已退出");
        }

        [DllImport("user32.dll")]
        private static extern bool ReleaseCapture();
        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern IntPtr SendMessage(IntPtr hWnd, int msg, int wParam, int lParam);
        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
        [DllImport("user32.dll")]
        private static extern bool RegisterHotKey(IntPtr hWnd, int id, int fsModifiers, int vk);
        [DllImport("user32.dll")]
        private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    }
}
