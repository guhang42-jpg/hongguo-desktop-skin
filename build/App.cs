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
        [STAThread]
        static void Main(string[] args)
        {
            Demo = args != null && Array.IndexOf(args, "--demo") >= 0;
            Fs = args != null && Array.IndexOf(args, "--fs") >= 0;
            Mini = args != null && Array.IndexOf(args, "--mini") >= 0;
            Mine = args != null && Array.IndexOf(args, "--mine") >= 0;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            AppDir = Path.GetDirectoryName(Application.ExecutablePath);
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

        private async Task StartAsync()
        {
            Log("窗口已创建");
            bool started = await StartCoreAsync();
            if (!started)
            {
                Log("首次启动失败，重试一次");
                await Task.Delay(1200);
                started = await StartCoreAsync();
            }
            if (!started)
            {
                MessageBox.Show("内置服务没有启动起来，无法继续。\r\n请查看目录里的 app.log。", "红果短剧", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
                return;
            }
            Log("core 就绪: " + coreUrl);

            try
            {
                string dataDir = Path.Combine(Program.AppDir, "webview2");
                Directory.CreateDirectory(dataDir);
                var env = await CoreWebView2Environment.CreateAsync(null, dataDir);
                await web.EnsureCoreWebView2Async(env);
                var settings = web.CoreWebView2.Settings;
                settings.AreDefaultContextMenusEnabled = false;
                settings.IsStatusBarEnabled = false;
                settings.UserAgent = settings.UserAgent + " HongguoSkin/1.0";

                web.CoreWebView2.WebResourceRequested += OnWebResourceRequested;
                web.CoreWebView2.AddWebResourceRequestedFilter(coreUrl + "/skin/*", CoreWebView2WebResourceContext.All);
                web.CoreWebView2.WebMessageReceived += OnWebMessage;
                web.CoreWebView2.ProcessFailed += (s, e) => Log("webview 进程异常: " + e.ProcessFailedKind);

                Log("打开界面");
                web.CoreWebView2.Navigate(coreUrl + "/skin/index.html" + (Program.Demo ? "?demo=1" + (Program.Mini ? "&mini=1" : "") + (Program.Fs ? "&fs=1" : "") + (Program.Mine ? "&mine=1" : "") : ""));
            }
            catch (Exception ex)
            {
                Log("WebView2 初始化失败: " + ex);
                MessageBox.Show("WebView2 运行时初始化失败：\r\n" + ex.Message, "红果短剧", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        }

        private async Task<bool> StartCoreAsync()
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
            string dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "HonggoDesktop");
            psi.EnvironmentVariables["HONGGUO_TV_DATA_DIR"] = dataDir;

            var ready = new TaskCompletionSource<string>();
            core = new Process { StartInfo = psi };
            core.OutputDataReceived += (s, e) => Scan(e.Data, ready);
            core.ErrorDataReceived += (s, e) => Scan(e.Data, ready);
            core.Exited += (s, e) => { if (!closing) { Log("core 进程退出，代码 " + core.ExitCode); ready.TrySetResult(""); } };
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
                if (await Task.WhenAny(task, Task.Delay(15000)) == task) port = task.Result;
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
                Log("[ui] " + msg);
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
                            var wm = Regex.Match(msg, "\"h\"\\s*:\\s*(\\d+)");
                            if (wm.Success && isMini)
                            {
                                var wa2 = Screen.FromControl(this).WorkingArea;
                                int h = Math.Max(180, Math.Min(wa2.Height - 8, int.Parse(wm.Groups[1].Value)));
                                var r = Bounds;
                                Bounds = new Rectangle(r.X, r.Bottom - h, r.Width, h);
                                Log("小窗适配画面 " + r.Width + "x" + h);
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
                    default: return;
                }
            }
            catch { }
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
                MinimumSize = new Size(300, 420);
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
                prevBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
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
        }

        // 无边框窗口的四边拖拽缩放
        protected override void WndProc(ref Message m)
        {
            const int WM_NCHITTEST = 0x84;
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
    }
}
