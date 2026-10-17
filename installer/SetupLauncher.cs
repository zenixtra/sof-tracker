// SoF-Tracker-Setup.exe: carries app.zip and install.ps1 as embedded resources,
// unpacks them to a temporary folder and runs the PowerShell installer.
// Built by installer\build.ps1 with the C# compiler that ships with Windows (.NET Framework 4).
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("SoF Tracker Setup")]
[assembly: AssemblyProduct("SoF Tracker")]

static class Setup
{
    [STAThread]
    static int Main(string[] args)
    {
        string tmp = Path.Combine(Path.GetTempPath(), "sof-tracker-setup-" + Guid.NewGuid().ToString("N").Substring(0, 8));
        try
        {
            Directory.CreateDirectory(tmp);
            Assembly asm = Assembly.GetExecutingAssembly();
            foreach (string name in new[] { "app.zip", "install.ps1" })
            {
                using (Stream s = asm.GetManifestResourceStream(name))
                using (FileStream f = File.Create(Path.Combine(tmp, name)))
                    s.CopyTo(f);
            }
            // pass any extra arguments through (e.g. -InstallDir, -Silent) for testing
            string extra = "";
            foreach (string a in args) extra += " \"" + a.Replace("\"", "") + "\"";
            var psi = new ProcessStartInfo("powershell.exe",
                "-NoProfile -ExecutionPolicy Bypass -File \"" + Path.Combine(tmp, "install.ps1") + "\"" + extra);
            psi.UseShellExecute = false;
            Process p = Process.Start(psi);
            p.WaitForExit();
            if (p.ExitCode != 0)
            {
                Console.WriteLine();
                Console.WriteLine("  Setup did not finish. Press Enter to close.");
                Console.ReadLine();
            }
            return p.ExitCode;
        }
        catch (Exception e)
        {
            MessageBox.Show("Setup failed: " + e.Message, "SoF Tracker setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            try { Directory.Delete(tmp, true); } catch { }
        }
    }
}
