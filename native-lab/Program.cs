using System.Drawing;
using System.IO;
using System.Windows.Forms;

namespace NativeComputerUseLab;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var outputPath = args.Length > 0 ? args[0] : Path.Combine(Path.GetTempPath(), "agent-computer-use-native-lab.txt");
        Application.Run(new LabForm(outputPath));
    }
}

internal sealed class LabForm : Form
{
    private readonly string _outputPath;
    private readonly TextBox _nameTextBox;
    private readonly Label _statusValue;

    public LabForm(string outputPath)
    {
        _outputPath = outputPath;
        Text = $"Agent Computer Use Native Lab - {Path.GetFileName(outputPath)}";
        Width = 720;
        Height = 420;
        StartPosition = FormStartPosition.CenterScreen;

        var title = new Label
        {
            Text = "Native Computer Use Lab",
            AutoSize = true,
            Font = new Font(Font.FontFamily, 18, FontStyle.Bold),
            Location = new Point(28, 24),
        };

        var nameLabel = new Label
        {
            Text = "Name",
            AutoSize = true,
            Location = new Point(32, 86),
        };

        _nameTextBox = new TextBox
        {
            Name = "NameTextBox",
            AccessibleName = "Name",
            Location = new Point(32, 112),
            Width = 500,
        };

        var saveButton = new Button
        {
            Name = "SaveButton",
            AccessibleName = "Save",
            Text = "Save",
            Location = new Point(548, 110),
            Width = 92,
            Height = 32,
        };
        saveButton.Click += (_, _) => Save();

        var statusLabel = new Label
        {
            Text = "Status",
            AutoSize = true,
            Location = new Point(32, 172),
        };

        _statusValue = new Label
        {
            Name = "StatusValue",
            AccessibleName = "Status",
            Text = "Idle",
            AutoSize = true,
            Font = new Font(Font.FontFamily, 12, FontStyle.Bold),
            Location = new Point(32, 198),
        };

        var fileLabel = new Label
        {
            Text = _outputPath,
            AutoSize = false,
            Location = new Point(32, 258),
            Width = 620,
            Height = 48,
        };

        Controls.AddRange([title, nameLabel, _nameTextBox, saveButton, statusLabel, _statusValue, fileLabel]);
    }

    private void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_outputPath)!);
        var value = _nameTextBox.Text;
        File.WriteAllText(_outputPath, value);
        _statusValue.Text = $"Saved: {value}";
    }
}
