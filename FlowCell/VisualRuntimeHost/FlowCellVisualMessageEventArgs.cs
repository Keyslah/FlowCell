using System;

namespace FlowCell.VisualRuntimeHost
{
    public sealed class FlowCellVisualMessageEventArgs : EventArgs
    {
        public FlowCellVisualMessageEventArgs(string messageJson)
        {
            MessageJson = messageJson ?? string.Empty;
        }

        public string MessageJson { get; }
    }
}
