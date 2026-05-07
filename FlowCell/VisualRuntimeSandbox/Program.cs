using FlowCell.VisualRuntimeHost;
using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace FlowCell.VisualRuntimeSandbox
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            var app = new Application();
            app.Startup += async (_, __) =>
            {
                var window = CreateWindow();
                window.Show();
                await InitializeWindowAsync(window, args).ConfigureAwait(true);
            };
            app.Run();
        }

        private static Window CreateWindow()
        {
            return new Window
            {
                Title = "FlowCell Visual Runtime Sandbox",
                Width = 960,
                Height = 540,
                MinWidth = 720,
                MinHeight = 420,
                Background = new SolidColorBrush(Color.FromRgb(18, 22, 20)),
                Foreground = Brushes.White,
                WindowStartupLocation = WindowStartupLocation.CenterScreen
            };
        }

        private static async Task InitializeWindowAsync(Window window, string[] args)
        {
            var repoRoot = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", ".."));
            var runtimeRoot = Path.Combine(repoRoot, "runtime", "visual-runtime");
            var groupRoot = Path.Combine(repoRoot, "dev", "visual-style-sandbox", "style_groups", "group_001");
            var screenshotPath = string.Empty;

            for (var index = 0; index < args.Length; index++)
            {
                if (string.Equals(args[index], "--group", StringComparison.OrdinalIgnoreCase) && index + 1 < args.Length)
                {
                    groupRoot = Path.GetFullPath(args[index + 1]);
                    index += 1;
                    continue;
                }

                if (string.Equals(args[index], "--screenshot", StringComparison.OrdinalIgnoreCase) && index + 1 < args.Length)
                {
                    screenshotPath = Path.GetFullPath(args[index + 1]);
                    index += 1;
                }
            }

            var payloadJson = @"{
  ""schemaVersion"": 1,
  ""renderTarget"": ""button"",
  ""group"": {
    ""id"": 1,
    ""name"": ""Group 1""
  },
  ""panel"": {
    ""id"": ""sandbox_panel"",
    ""name"": ""Sandbox"",
    ""programTabId"": 99,
    ""programLabel"": ""Sandbox""
  },
  ""button"": {
    ""id"": ""sandbox_button_primary"",
    ""label"": ""Launch Bloom"",
    ""tooltip"": ""Fake sandbox button for runtime validation."",
    ""shortcut"": ""Ctrl+Alt+1"",
    ""kind"": ""script"",
    ""target"": ""D:\\Dev\\workspace\\Codex\\flowcell\\Sandbox\\Launch-Bloom.ps1"",
    ""accentColor"": ""#9CFF18"",
    ""styleGroupId"": 1
  },
  ""states"": {
    ""hovered"": false,
    ""active"": false,
    ""pressed"": false,
    ""disabled"": false,
    ""selected"": true,
    ""longLabel"": false
  }
}";

            var root = new Grid
            {
                Margin = new Thickness(28)
            };
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            var heading = new StackPanel
            {
                Orientation = Orientation.Vertical,
                Margin = new Thickness(0, 0, 0, 18)
            };
            heading.Children.Add(new TextBlock
            {
                Text = "Visual Runtime Host Proof",
                FontSize = 26,
                FontWeight = FontWeights.Light,
                Foreground = Brushes.White
            });
            heading.Children.Add(new TextBlock
            {
                Text = "One imported FlowCell style group rendered in isolation with metadata, CSS, and asset-backed HTML.",
                FontSize = 13,
                Foreground = new SolidColorBrush(Color.FromArgb(220, 223, 236, 223)),
                TextWrapping = TextWrapping.Wrap
            });
            root.Children.Add(heading);

            var stage = new Border
            {
                Padding = new Thickness(32),
                CornerRadius = new CornerRadius(28),
                Background = new LinearGradientBrush(
                    Color.FromRgb(28, 36, 23),
                    Color.FromRgb(10, 12, 9),
                    90),
                BorderThickness = new Thickness(1),
                BorderBrush = new SolidColorBrush(Color.FromArgb(90, 233, 255, 196))
            };
            Grid.SetRow(stage, 1);

            var stageGrid = new Grid();
            stage.Child = stageGrid;

            var renderer = new FlowCellVisualRenderer
            {
                Width = 280,
                Height = 96,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                RuntimeRootPath = runtimeRoot,
                GroupFolderPath = groupRoot,
                PayloadJson = payloadJson,
                ClickEnabled = false
            };
            stageGrid.Children.Add(renderer);

            root.Children.Add(stage);
            window.Content = root;

            await renderer.RefreshAsync().ConfigureAwait(true);

            if (!string.IsNullOrWhiteSpace(screenshotPath))
            {
                await Task.Delay(1800).ConfigureAwait(true);
                SaveWindowScreenshot(window, screenshotPath);
                await Task.Delay(250).ConfigureAwait(true);
                window.Close();
            }
        }

        private static void SaveWindowScreenshot(Window window, string screenshotPath)
        {
            if (!(window.Content is FrameworkElement root))
            {
                return;
            }

            root.Measure(new Size(window.ActualWidth, window.ActualHeight));
            root.Arrange(new Rect(new Point(0, 0), new Size(window.ActualWidth, window.ActualHeight)));
            root.UpdateLayout();

            var bitmap = new RenderTargetBitmap(
                Math.Max((int)Math.Ceiling(root.ActualWidth), 1),
                Math.Max((int)Math.Ceiling(root.ActualHeight), 1),
                96,
                96,
                PixelFormats.Pbgra32);
            bitmap.Render(root);

            var folderPath = Path.GetDirectoryName(screenshotPath);
            if (!string.IsNullOrWhiteSpace(folderPath))
            {
                Directory.CreateDirectory(folderPath);
            }

            var encoder = new PngBitmapEncoder();
            encoder.Frames.Add(BitmapFrame.Create(bitmap));

            using (var stream = File.Create(screenshotPath))
            {
                encoder.Save(stream);
            }
        }
    }
}
