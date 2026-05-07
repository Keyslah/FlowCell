using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace FlowCell.VisualRuntimeHost
{
    public sealed class FlowCellVisualRenderer : Border, IDisposable
    {
        private const string RuntimeHostName = "flowcell-runtime";
        private const string GroupHostName = "flowcell-group";
        private const string HostPageUrl = "https://flowcell-runtime/host.html";

        private readonly Grid _root;
        private readonly Border _statusShell;
        private readonly TextBlock _statusText;
        private readonly WebView2 _webView;
        private string _runtimeRootPath = string.Empty;
        private string _groupFolderPath = string.Empty;
        private string _payloadJson = "{}";
        private bool _clickEnabled = true;
        private bool _initialized;
        private bool _hostReady;
        private string _mappedRuntimeRoot = string.Empty;
        private string _mappedGroupRoot = string.Empty;

        public FlowCellVisualRenderer()
        {
            Background = Brushes.Transparent;
            BorderBrush = Brushes.Transparent;
            BorderThickness = new Thickness(0);
            CornerRadius = new CornerRadius(0);
            SnapsToDevicePixels = true;

            _root = new Grid();
            Child = _root;

            _webView = new WebView2
            {
                HorizontalAlignment = HorizontalAlignment.Stretch,
                VerticalAlignment = VerticalAlignment.Stretch,
                Margin = new Thickness(0),
                DefaultBackgroundColor = System.Drawing.Color.Transparent
            };

            _statusText = new TextBlock
            {
                Text = "Preparing visual runtime...",
                Foreground = Brushes.White,
                FontSize = 11,
                TextWrapping = TextWrapping.Wrap,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(10)
            };

            _statusShell = new Border
            {
                CornerRadius = new CornerRadius(12),
                BorderThickness = new Thickness(1),
                BorderBrush = new SolidColorBrush(Color.FromArgb(70, 255, 255, 255)),
                Background = new SolidColorBrush(Color.FromArgb(150, 19, 26, 15)),
                Child = _statusText
            };

            _root.Children.Add(_webView);
            _root.Children.Add(_statusShell);

            Loaded += async (_, __) => await RefreshAsync().ConfigureAwait(true);
        }

        public event EventHandler Activated;
        public event EventHandler<FlowCellVisualMessageEventArgs> RuntimeMessageReceived;

        public string RuntimeRootPath
        {
            get => _runtimeRootPath;
            set
            {
                _runtimeRootPath = value ?? string.Empty;
                _ = RefreshAsync();
            }
        }

        public string GroupFolderPath
        {
            get => _groupFolderPath;
            set
            {
                _groupFolderPath = value ?? string.Empty;
                _ = RefreshAsync();
            }
        }

        public string PayloadJson
        {
            get => _payloadJson;
            set
            {
                _payloadJson = string.IsNullOrWhiteSpace(value) ? "{}" : value;
                _ = PushPayloadAsync();
            }
        }

        public bool ClickEnabled
        {
            get => _clickEnabled;
            set
            {
                _clickEnabled = value;
                _ = PushPayloadAsync();
            }
        }

        public async Task RefreshAsync()
        {
            if (!IsLoaded)
            {
                return;
            }

            if (string.IsNullOrWhiteSpace(RuntimeRootPath) || !Directory.Exists(RuntimeRootPath))
            {
                ShowStatus("Visual runtime files were not found.");
                return;
            }

            await EnsureInitializedAsync().ConfigureAwait(true);
            ApplyHostMappings();

            if (_webView.Source == null || !string.Equals(_webView.Source.AbsoluteUri, HostPageUrl, StringComparison.OrdinalIgnoreCase))
            {
                _hostReady = false;
                _webView.Source = new Uri(HostPageUrl);
                ShowStatus("Loading visual runtime...");
                return;
            }

            if (_hostReady)
            {
                await PushPayloadAsync().ConfigureAwait(true);
            }
        }

        private async Task EnsureInitializedAsync()
        {
            if (_initialized)
            {
                return;
            }

            var userDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "FlowCell",
                "WebView2",
                "VisualRuntimeHost");

            Directory.CreateDirectory(userDataFolder);
            var environment = await CoreWebView2Environment.CreateAsync(null, userDataFolder).ConfigureAwait(true);
            await _webView.EnsureCoreWebView2Async(environment).ConfigureAwait(true);

            _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            _webView.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
            _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            _webView.CoreWebView2.Settings.IsZoomControlEnabled = false;
            _webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
            _webView.CoreWebView2.WebMessageReceived += CoreWebView2_WebMessageReceived;
            _webView.NavigationCompleted += WebView_NavigationCompleted;

            _initialized = true;
        }

        private void ApplyHostMappings()
        {
            if (_webView.CoreWebView2 == null)
            {
                return;
            }

            if (!string.Equals(_mappedRuntimeRoot, RuntimeRootPath, StringComparison.OrdinalIgnoreCase))
            {
                _webView.CoreWebView2.SetVirtualHostNameToFolderMapping(RuntimeHostName, RuntimeRootPath, CoreWebView2HostResourceAccessKind.Allow);
                _mappedRuntimeRoot = RuntimeRootPath;
            }

            var resolvedGroupRoot = Directory.Exists(GroupFolderPath) ? GroupFolderPath : RuntimeRootPath;
            if (!string.Equals(_mappedGroupRoot, resolvedGroupRoot, StringComparison.OrdinalIgnoreCase))
            {
                _webView.CoreWebView2.SetVirtualHostNameToFolderMapping(GroupHostName, resolvedGroupRoot, CoreWebView2HostResourceAccessKind.Allow);
                _mappedGroupRoot = resolvedGroupRoot;
            }
        }

        private async void WebView_NavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            _hostReady = e.IsSuccess;
            if (!e.IsSuccess)
            {
                ShowStatus("Visual runtime navigation failed.");
                return;
            }

            ShowStatus("Visual runtime ready.");
            await PushPayloadAsync().ConfigureAwait(true);
        }

        private async Task PushPayloadAsync()
        {
            if (!_hostReady || _webView.CoreWebView2 == null)
            {
                return;
            }

            var messageJson = "{\"type\":\"host-config\",\"clickEnabled\":" +
                              (_clickEnabled ? "true" : "false") +
                              ",\"payload\":" + (string.IsNullOrWhiteSpace(_payloadJson) ? "{}" : _payloadJson) + "}";

            _webView.CoreWebView2.PostWebMessageAsJson(messageJson);
            await Task.CompletedTask.ConfigureAwait(true);
        }

        private void CoreWebView2_WebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            var messageJson = e.WebMessageAsJson ?? string.Empty;
            RuntimeMessageReceived?.Invoke(this, new FlowCellVisualMessageEventArgs(messageJson));

            var type = ExtractJsonStringValue(messageJson, "type");
            if (string.Equals(type, "activate", StringComparison.OrdinalIgnoreCase))
            {
                Activated?.Invoke(this, EventArgs.Empty);
                return;
            }

            if (string.Equals(type, "status", StringComparison.OrdinalIgnoreCase))
            {
                var state = ExtractJsonStringValue(messageJson, "state");
                if (!string.IsNullOrWhiteSpace(state) &&
                    (string.Equals(state, "rendered", StringComparison.OrdinalIgnoreCase) ||
                     string.Equals(state, "rendered-fallback", StringComparison.OrdinalIgnoreCase)))
                {
                    HideStatus();
                }
                return;
            }

            if (string.Equals(type, "error", StringComparison.OrdinalIgnoreCase))
            {
                var message = ExtractJsonStringValue(messageJson, "message");
                ShowStatus(string.IsNullOrWhiteSpace(message) ? "Visual runtime error." : message);
            }
        }

        private static string ExtractJsonStringValue(string json, string key)
        {
            if (string.IsNullOrWhiteSpace(json) || string.IsNullOrWhiteSpace(key))
            {
                return string.Empty;
            }

            var match = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"(?<value>(?:\\\\.|[^\"])*)\"", RegexOptions.IgnoreCase);
            if (!match.Success)
            {
                return string.Empty;
            }

            return match.Groups["value"].Value.Replace("\\\"", "\"");
        }

        private void ShowStatus(string message)
        {
            _statusText.Text = string.IsNullOrWhiteSpace(message) ? "Preparing visual runtime..." : message;
            _statusShell.Visibility = Visibility.Visible;
        }

        private void HideStatus()
        {
            _statusShell.Visibility = Visibility.Collapsed;
        }

        public void Dispose()
        {
            try
            {
                _webView?.Dispose();
            }
            catch
            {
            }
        }
    }
}
