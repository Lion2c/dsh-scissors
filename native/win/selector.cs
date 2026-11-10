// dsh-scissors - Windows region selector.
//
// Freezes the virtual screen into a bitmap, dims it, lets the user drag a
// rectangle, and saves the crop as PNG. Exit codes:
//   0  saved
//   2  cancelled (Esc, right click, or a click without a drag)
//   3  failure (details are written to "<output>.err")
//
// With --hide the window that is foreground when the process starts (the DSH
// window that requested the capture) is hidden before the screen is frozen and
// is shown and focused again when the selector closes, on every exit path.
//
// This file is compiled on demand with the .NET Framework csc.exe. Keep it
// compatible with C# 5 and avoid non-ASCII literals so csc's default source
// encoding can never corrupt a message.

using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

static class Native
{
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr window);
}

sealed class SelectorForm : Form
{
    public const int MinimumSide = 4;

    readonly Bitmap screen;
    readonly Bitmap dimmed;

    Point anchor;
    bool dragging;
    Rectangle selection = Rectangle.Empty;

    public bool Completed;
    public Rectangle Chosen = Rectangle.Empty;

    public SelectorForm(Bitmap screenshot, Rectangle bounds)
    {
        screen = screenshot;
        dimmed = new Bitmap(screen.Width, screen.Height, PixelFormat.Format32bppRgb);
        using (Graphics g = Graphics.FromImage(dimmed))
        {
            g.CompositingMode = CompositingMode.SourceCopy;
            g.DrawImageUnscaled(screen, 0, 0);
            g.CompositingMode = CompositingMode.SourceOver;
            using (SolidBrush shade = new SolidBrush(Color.FromArgb(112, 0, 0, 0)))
            {
                g.FillRectangle(shade, 0, 0, dimmed.Width, dimmed.Height);
            }
        }

        Bounds = bounds;
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        TopMost = true;
        ShowInTaskbar = false;
        KeyPreview = true;
        DoubleBuffered = true;
        BackColor = Color.Black;
        Cursor = Cursors.Cross;
        AutoScaleMode = AutoScaleMode.None;
        SetStyle(
            ControlStyles.AllPaintingInWmPaint
            | ControlStyles.OptimizedDoubleBuffer
            | ControlStyles.UserPaint
            | ControlStyles.Opaque,
            true);
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        Activate();
        Focus();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        Rectangle clip = e.ClipRectangle;

        g.DrawImage(dimmed, clip, clip, GraphicsUnit.Pixel);

        if (selection.Width > 0 && selection.Height > 0)
        {
            g.DrawImage(screen, selection, selection, GraphicsUnit.Pixel);
            using (Pen border = new Pen(Color.FromArgb(255, 59, 158, 255), 1f))
            {
                g.DrawRectangle(border, selection);
            }
            DrawSizeLabel(g, selection);
        }
        else
        {
            DrawHint(g);
        }
    }

    void DrawHint(Graphics g)
    {
        const string hint = "Drag to select a region   |   Esc to cancel";
        using (Font font = new Font("Segoe UI", 10f, FontStyle.Regular))
        {
            SizeF size = g.MeasureString(hint, font);
            int width = (int)size.Width + 28;
            int height = (int)size.Height + 14;
            int x = (Width - width) / 2;
            int y = 28;
            Rectangle box = new Rectangle(x, y, width, height);
            using (GraphicsPath path = RoundRect(box, 9))
            using (SolidBrush fill = new SolidBrush(Color.FromArgb(230, 22, 22, 26)))
            {
                g.FillPath(fill, path);
            }
            using (SolidBrush text = new SolidBrush(Color.FromArgb(240, 255, 255, 255)))
            {
                g.DrawString(hint, font, text, x + 14, y + 7);
            }
        }
    }

    void DrawSizeLabel(Graphics g, Rectangle area)
    {
        string label = area.Width + " x " + area.Height;
        using (Font font = new Font("Segoe UI", 8.5f, FontStyle.Bold))
        {
            SizeF size = g.MeasureString(label, font);
            int width = (int)size.Width + 14;
            int height = (int)size.Height + 6;
            int x = area.X;
            int y = area.Y - height - 8;
            if (y < 4) y = area.Y + 8;
            if (x + width > Width - 4) x = Width - width - 4;
            if (x < 4) x = 4;
            Rectangle box = new Rectangle(x, y, width, height);
            using (GraphicsPath path = RoundRect(box, 5))
            using (SolidBrush fill = new SolidBrush(Color.FromArgb(215, 20, 20, 24)))
            {
                g.FillPath(fill, path);
            }
            using (SolidBrush text = new SolidBrush(Color.White))
            {
                g.DrawString(label, font, text, x + 7, y + 3);
            }
        }
    }

    static GraphicsPath RoundRect(Rectangle rect, int radius)
    {
        GraphicsPath path = new GraphicsPath();
        int d = radius * 2;
        path.AddArc(rect.X, rect.Y, d, d, 180, 90);
        path.AddArc(rect.Right - d, rect.Y, d, d, 270, 90);
        path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
        path.AddArc(rect.X, rect.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button == MouseButtons.Right)
        {
            Completed = false;
            Close();
            return;
        }
        if (e.Button != MouseButtons.Left) return;

        dragging = true;
        anchor = e.Location;
        selection = Rectangle.Empty;
        Invalidate();
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (!dragging) return;

        int x = Math.Min(anchor.X, e.X);
        int y = Math.Min(anchor.Y, e.Y);
        int width = Math.Abs(anchor.X - e.X);
        int height = Math.Abs(anchor.Y - e.Y);
        Rectangle next = new Rectangle(x, y, width, height);
        next.Intersect(new Rectangle(0, 0, screen.Width, screen.Height));
        selection = next;
        Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (!dragging || e.Button != MouseButtons.Left) return;
        dragging = false;

        if (selection.Width < MinimumSide || selection.Height < MinimumSide)
        {
            selection = Rectangle.Empty;
            Invalidate();
            return;
        }

        Completed = true;
        Chosen = selection;
        Close();
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.KeyCode == Keys.Escape)
        {
            e.SuppressKeyPress = true;
            Completed = false;
            Close();
            return;
        }
        if (e.KeyCode == Keys.Enter && selection.Width >= MinimumSide && selection.Height >= MinimumSide)
        {
            e.SuppressKeyPress = true;
            Completed = true;
            Chosen = selection;
            Close();
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            // `screen` is owned by Main so the crop can still be taken after
            // the form closes; only the derived dimmed copy belongs here.
            dimmed.Dispose();
        }
        base.Dispose(disposing);
    }
}

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        string output = null;
        bool hide = false;
        long restore = 0;
        for (int i = 0; i < args.Length; i++)
        {
            string arg = args[i];
            if (arg == "--hide") hide = true;
            else if (arg == "--restore" && i + 1 < args.Length)
            {
                long.TryParse(args[++i], out restore);
            }
            else if (arg.Length > 0 && !arg.StartsWith("--") && output == null) output = arg;
        }

        if (restore != 0)
        {
            // Recovery path: the host timed out and killed a selector that had
            // hidden a window; put that window back without a capture.
            IntPtr target = new IntPtr(restore);
            if (Native.IsWindow(target))
            {
                Native.ShowWindow(target, 5); // SW_SHOW
                Native.SetForegroundWindow(target);
            }
            return 0;
        }

        if (output == null)
        {
            Console.Error.WriteLine("missing output path");
            return 3;
        }

        try
        {
            try
            {
                // PER_MONITOR_AWARE_V2 on Windows 10 1703+, system DPI otherwise.
                if (!Native.SetProcessDpiAwarenessContext(new IntPtr(-4))) Native.SetProcessDPIAware();
            }
            catch
            {
                try { Native.SetProcessDPIAware(); } catch { }
            }

            IntPtr hidden = IntPtr.Zero;
            if (hide)
            {
                hidden = Native.GetForegroundWindow();
                if (hidden != IntPtr.Zero)
                {
                    Native.ShowWindow(hidden, 0); // SW_HIDE
                    // The host reads this sidecar if it has to kill the process
                    // before the finally block could restore the window.
                    try { File.WriteAllText(output + ".hwnd", hidden.ToInt64().ToString()); } catch { }
                    // Let the hide animation finish before freezing the screen.
                    Thread.Sleep(320);
                }
            }

            try
            {
                Rectangle bounds = SystemInformation.VirtualScreen;
                using (Bitmap screenshot = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppRgb))
                {
                    using (Graphics g = Graphics.FromImage(screenshot))
                    {
                        g.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
                    }

                    using (SelectorForm form = new SelectorForm(screenshot, bounds))
                    {
                        Application.Run(form);
                        if (!form.Completed) return 2;

                        Rectangle area = form.Chosen;
                        area.Intersect(new Rectangle(0, 0, screenshot.Width, screenshot.Height));
                        if (area.Width < SelectorForm.MinimumSide || area.Height < SelectorForm.MinimumSide) return 2;

                        using (Bitmap crop = screenshot.Clone(area, screenshot.PixelFormat))
                        {
                            crop.Save(output, ImageFormat.Png);
                        }
                    }
                }
                return File.Exists(output) && new FileInfo(output).Length > 0 ? 0 : 3;
            }
            finally
            {
                if (hidden != IntPtr.Zero && Native.IsWindow(hidden))
                {
                    Native.ShowWindow(hidden, 5); // SW_SHOW
                    Native.SetForegroundWindow(hidden);
                }
                try { File.Delete(output + ".hwnd"); } catch { }
            }
        }
        catch (Exception error)
        {
            try { File.WriteAllText(output + ".err", error.ToString()); } catch { }
            return 3;
        }
    }
}
