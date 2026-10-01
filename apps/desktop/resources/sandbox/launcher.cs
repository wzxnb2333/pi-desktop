// Built locally with the Windows .NET Framework compiler; no downloaded executable.
// The broker retains its token; only the child receives an AppContainer token.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

class SandboxLauncher {
  public class Request { public string cwd; public string temp; public string command; public int timeoutMs; }
  public class Lease { public int version; public string profile,cwd,temp; }
  [StructLayout(LayoutKind.Sequential)] struct Capabilities { public IntPtr sid, capabilities; public int count, reserved; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public int cb; public string reserved, desktop, title; public int x,y,xs,ys,xc,yc,fill,flags; public short show,cbReserved;
    public IntPtr reserved2,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup startup; public IntPtr attributes; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public int pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes { public int length; public IntPtr descriptor; public int inherit; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimit { public long processTime,jobTime; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong r,w,o,rb,wb,ob; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit { public BasicLimit basic; public IoCounters io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int CreateAppContainerProfile(string name,string display,string description,IntPtr capabilities,int count,out IntPtr sid);
  [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int DeleteAppContainerProfile(string name);
  [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int DeriveAppContainerSidFromAppContainerName(string name,out IntPtr sid);
  [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr sid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string cwd,ref StartupEx startup,out ProcessInfo process);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int info,ref ExtendedLimit limits,int size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref SecurityAttributes security,int size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
  static void Check(bool result) { if (!result) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  sealed class Grant { public string path; public bool directory; public FileSystemAccessRule rule; }
  static readonly List<Grant> grants = new List<Grant>();
  static void WithAclLock(string path,Action action) {
    string key;
    using(var hash=SHA256.Create()) key=BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(path).ToUpperInvariant()))).Replace("-","");
    using(var mutex=new Mutex(false,"Local\\PiDesktop.SandboxAcl."+key)) {
      bool acquired=false;
      try { try { acquired=mutex.WaitOne(30000); } catch(AbandonedMutexException) { acquired=true; }
        if(!acquired) throw new IOException("Sandbox ACL is busy");
        action();
      } finally { if(acquired) mutex.ReleaseMutex(); }
    }
  }
  static void Acl(string path,SecurityIdentifier sid,FileSystemRights rights,bool recursive,AccessControlType type) {
    bool directory = Directory.Exists(path);
    if (!directory && !File.Exists(path)) return;
    if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new IOException("Sandbox ACL path is a reparse point: " + path);
    var rule = new FileSystemAccessRule(sid,rights,recursive && directory ? InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit : InheritanceFlags.None,PropagationFlags.None,type);
    grants.Add(new Grant { path=path,directory=directory,rule=rule });
    WithAclLock(path,() => {
      FileSystemSecurity acl = directory ? (FileSystemSecurity)Directory.GetAccessControl(path) : File.GetAccessControl(path);
      acl.AddAccessRule(rule);
      if (directory) Directory.SetAccessControl(path,(DirectorySecurity)acl); else File.SetAccessControl(path,(FileSecurity)acl);
    });
  }
  static void UnlinkedPath(string path) {
    string current=Path.GetFullPath(path);
    while(!String.IsNullOrEmpty(current)) {
      if((Directory.Exists(current)||File.Exists(current)) && (File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)
        throw new IOException("Sandbox recovery path is linked: "+current);
      current=Path.GetDirectoryName(current);
    }
  }
  static void RemoveRun(string path) {
    UnlinkedPath(path);
    for(int attempt=0;;attempt++) {
      try { if(Directory.Exists(path)) Directory.Delete(path,true); return; }
      catch { if(attempt==7) throw; Thread.Sleep(125); }
    }
  }
  static void RemoveProfile(string profile) {
    int result=DeleteAppContainerProfile(profile);
    if(result<0 && result!=unchecked((int)0x80070002) && result!=unchecked((int)0x80070003)) Marshal.ThrowExceptionForHR(result);
  }
  static int Recover(string directory) {
    try {
      directory=Path.GetFullPath(directory);
      if(Path.GetFileName(directory)!="sandbox-leases") throw new IOException("Invalid sandbox recovery directory");
      UnlinkedPath(directory);
      int recovered=0,active=0;
      if(!Directory.Exists(directory)) return 0;
      foreach(string path in Directory.GetFiles(directory,"*.json")) {
        UnlinkedPath(path);
        FileStream lease;
        try { lease=new FileStream(path,FileMode.Open,FileAccess.ReadWrite,FileShare.None); }
        catch(FileNotFoundException) { continue; }
        catch(IOException error) {
          int code=error.HResult&0xffff;
          if(code==32 || code==33) { active++; continue; } // A live broker/recovery owns the lock.
          throw;
        }
        using(lease) {
          if(lease.Length>65536) throw new IOException("Sandbox recovery record is too large");
          Lease record;
          using(var reader=new StreamReader(lease,Encoding.UTF8,true,1024,true)) record=new JavaScriptSerializer().Deserialize<Lease>(reader.ReadToEnd());
          Guid identity;
          if(record==null || record.version!=1 || record.profile==null || !record.profile.StartsWith("PiDesktop.Run.",StringComparison.Ordinal) ||
            !Guid.TryParseExact(record.profile.Substring(14),"N",out identity) || Path.GetFileName(path)!=record.profile+".json" ||
            String.IsNullOrEmpty(record.cwd) || String.IsNullOrEmpty(record.temp) || !Path.IsPathRooted(record.cwd) || !Path.IsPathRooted(record.temp))
            throw new IOException("Invalid sandbox recovery record: "+path);
          string storage=Path.GetDirectoryName(directory), runs=Path.Combine(storage,"sandbox-runs");
          if(!String.Equals(Path.GetDirectoryName(Path.GetFullPath(record.temp)),runs,StringComparison.OrdinalIgnoreCase) ||
            !Path.GetFileName(record.temp).StartsWith("run-",StringComparison.Ordinal) ||
            String.Equals(Path.GetFullPath(record.cwd),Path.GetPathRoot(record.cwd),StringComparison.OrdinalIgnoreCase))
            throw new IOException("Invalid sandbox recovery scope: "+path);
          UnlinkedPath(record.cwd); UnlinkedPath(record.temp);
          IntPtr sid=IntPtr.Zero;
          try {
            int hr=DeriveAppContainerSidFromAppContainerName(record.profile,out sid); if(hr<0) Marshal.ThrowExceptionForHR(hr);
            var package=new SecurityIdentifier(sid); grants.Clear();
            foreach(string root in new [] { record.cwd,record.temp }) grants.Add(new Grant { path=root,directory=true,
              rule=new FileSystemAccessRule(package,FileSystemRights.Modify,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow) });
            Cleanup(); RemoveProfile(record.profile); RemoveRun(record.temp);
          } finally { grants.Clear(); if(sid!=IntPtr.Zero) FreeSid(sid); }
        }
        File.Delete(path); recovered++;
      }
      Console.WriteLine(new JavaScriptSerializer().Serialize(new { recovered=recovered,active=active }));
      return 0;
    } catch(Exception error) { Console.Error.WriteLine("Sandbox recovery failed; record retained: "+error.Message); return 125; }
  }
  static void Cleanup() {
    Exception failure = null;
    for (int i=grants.Count-1;i>=0;i--) {
      var grant = grants[i];
      try {
        if (!Directory.Exists(grant.path) && !File.Exists(grant.path)) continue;
        if ((File.GetAttributes(grant.path) & FileAttributes.ReparsePoint) != 0) throw new IOException("Sandbox cleanup path changed: " + grant.path);
        WithAclLock(grant.path,() => {
          FileSystemSecurity acl = grant.directory ? (FileSystemSecurity)Directory.GetAccessControl(grant.path) : File.GetAccessControl(grant.path);
          acl.RemoveAccessRuleSpecific(grant.rule);
          if (grant.directory) Directory.SetAccessControl(grant.path,(DirectorySecurity)acl); else File.SetAccessControl(grant.path,(FileSecurity)acl);
        });
      } catch (Exception error) { failure = error; Console.Error.WriteLine("Sandbox ACL cleanup failed: " + error.Message); }
    }
    if (failure != null) throw failure;
  }
  static Task CopyOutput(IntPtr handle,Stream target) {
    return Task.Run(async () => { using (var stream = new FileStream(new SafeFileHandle(handle,true),FileAccess.Read,4096,false)) { await stream.CopyToAsync(target); } });
  }
  static int Main(string[] args) {
    Console.OutputEncoding = new UTF8Encoding(false);
    if(args.Length==2 && args[0]=="--recover") return Recover(args[1]);
    if(args.Length!=0) return 125;
    string profile = "PiDesktop.Run." + Guid.NewGuid().ToString("N");
    IntPtr sid=IntPtr.Zero,attrs=IntPtr.Zero,caps=IntPtr.Zero,handles=IntPtr.Zero,env=IntPtr.Zero,job=IntPtr.Zero;
    IntPtr outRead=IntPtr.Zero,outWrite=IntPtr.Zero,inRead=IntPtr.Zero,inWrite=IntPtr.Zero;
    ProcessInfo process = new ProcessInfo(); bool createdProfile=false,attributesInitialized=false; int exit=125;
    string runDirectory=null,leasePath=null; FileStream lease=null;
    try {
      var request = new JavaScriptSerializer().Deserialize<Request>(Console.ReadLine());
      if (request == null || !Directory.Exists(request.cwd) || !Directory.Exists(request.temp)) throw new IOException("Invalid sandbox request");
      if (!Path.GetFileName(request.temp).StartsWith("run-",StringComparison.Ordinal) || Path.GetFileName(Path.GetDirectoryName(request.temp))!="sandbox-runs") throw new IOException("Invalid sandbox temporary directory");
      runDirectory=request.temp;
      // Persist before creating the profile or changing ACLs. This directory is never granted to the sandbox.
      string leaseDirectory=Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(request.temp)),"sandbox-leases");
      UnlinkedPath(request.cwd); UnlinkedPath(request.temp); UnlinkedPath(leaseDirectory);
      Directory.CreateDirectory(leaseDirectory);
      leasePath=Path.Combine(leaseDirectory,profile+".json");
      lease=new FileStream(leasePath,FileMode.CreateNew,FileAccess.ReadWrite,FileShare.None);
      byte[] record=Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(new Lease { version=1,profile=profile,cwd=request.cwd,temp=request.temp }));
      lease.Write(record,0,record.Length); lease.Flush(true);
      int hr = CreateAppContainerProfile(profile,profile,"Pi Desktop isolated command",IntPtr.Zero,0,out sid);
      if (hr < 0) Marshal.ThrowExceptionForHR(hr); createdProfile=true;
      var identity = new SecurityIdentifier(sid);
      // Grant only this unique run SID. Never grant All Application Packages or lower a directory's integrity label.
      foreach (string root in new [] { request.cwd,request.temp }) {
        Acl(root,identity,FileSystemRights.Modify,true,AccessControlType.Allow);
      }
      job = CreateJobObject(IntPtr.Zero,null); if (job == IntPtr.Zero) throw new Win32Exception();
      var limits = new ExtendedLimit(); limits.basic.flags=0x2000; // KILL_ON_JOB_CLOSE; children cannot break away.
      Check(SetInformationJobObject(job,9,ref limits,Marshal.SizeOf(typeof(ExtendedLimit))));
      var security = new SecurityAttributes { length=Marshal.SizeOf(typeof(SecurityAttributes)),inherit=1 };
      Check(CreatePipe(out outRead,out outWrite,ref security,0)); Check(SetHandleInformation(outRead,1,0));
      Check(CreatePipe(out inRead,out inWrite,ref security,0)); Check(SetHandleInformation(inWrite,1,0));
      IntPtr size=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);
      attrs=Marshal.AllocHGlobal(size); Check(InitializeProcThreadAttributeList(attrs,2,0,ref size)); attributesInitialized=true;
      caps=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Capabilities))); Marshal.StructureToPtr(new Capabilities { sid=sid },caps,false);
      Check(UpdateProcThreadAttribute(attrs,0,(IntPtr)0x20009,caps,(IntPtr)Marshal.SizeOf(typeof(Capabilities)),IntPtr.Zero,IntPtr.Zero));
      handles=Marshal.AllocHGlobal(IntPtr.Size*2); Marshal.WriteIntPtr(handles,0,inRead); Marshal.WriteIntPtr(handles,IntPtr.Size,outWrite);
      Check(UpdateProcThreadAttribute(attrs,0,(IntPtr)0x20002,handles,(IntPtr)(IntPtr.Size*2),IntPtr.Zero,IntPtr.Zero));
      string windows=Environment.GetFolderPath(Environment.SpecialFolder.Windows);
      string shell=Path.Combine(windows,"System32","WindowsPowerShell","v1.0","powershell.exe");
      var environment=new SortedDictionary<string,string>(StringComparer.OrdinalIgnoreCase) {
        {"SystemRoot",windows},{"WINDIR",windows},{"ComSpec",Path.Combine(windows,"System32","cmd.exe")},
        {"PATH",Path.Combine(windows,"System32")+";"+Path.GetDirectoryName(shell)+";"+(Environment.GetEnvironmentVariable("PATH")??"")},
        {"PATHEXT",".COM;.EXE;.BAT;.CMD"},
        {"TEMP",request.temp},{"TMP",request.temp},{"USERPROFILE",request.temp},{"HOME",request.temp},
        {"APPDATA",request.temp},{"LOCALAPPDATA",request.temp},{"PI_SANDBOX","appcontainer"}
      };
      var block=new StringBuilder(); foreach(var pair in environment) block.Append(pair.Key+"="+pair.Value+'\0'); block.Append('\0');
      env=Marshal.StringToHGlobalUni(block.ToString());
      var startup=new StartupEx(); startup.startup.cb=Marshal.SizeOf(typeof(StartupEx)); startup.attributes=attrs;
      startup.startup.flags=0x100; startup.startup.input=inRead; startup.startup.output=outWrite; startup.startup.error=outWrite;
      string prefix="$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; New-PSDrive -Name Workspace -PSProvider FileSystem -Root '"+request.cwd.Replace("'","''")+"' | Out-Null; Set-Location 'Workspace:\\'; ";
      string script=Path.Combine(request.temp,"command.ps1");
      File.WriteAllText(script,prefix+request.command,new UTF8Encoding(true));
      Check(CreateProcess(shell,new StringBuilder('"'+shell+"\" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \""+script+'"'),IntPtr.Zero,IntPtr.Zero,true,0x08080404,env,request.cwd,ref startup,out process));
      Check(AssignProcessToJobObject(job,process.process));
      var copy=CopyOutput(outRead,Console.OpenStandardOutput()); outRead=IntPtr.Zero;
      CloseHandle(outWrite); outWrite=IntPtr.Zero; CloseHandle(inWrite); inWrite=IntPtr.Zero;
      int cancelled=0;
      Task.Run(() => { Console.ReadLine(); Interlocked.Exchange(ref cancelled,1); }); // EOF also cancels when the owning main process exits.
      if (ResumeThread(process.thread) == 0xffffffff) throw new Win32Exception();
      DateTime deadline=DateTime.UtcNow.AddMilliseconds(request.timeoutMs);
      while (WaitForSingleObject(process.process,40) == 0x102) {
        if (Volatile.Read(ref cancelled)!=0 || DateTime.UtcNow>=deadline) { TerminateJobObject(job,130); break; }
      }
      WaitForSingleObject(process.process,5000);
      uint code; Check(GetExitCodeProcess(process.process,out code)); exit=unchecked((int)code);
      Check(TerminateJobObject(job,130)); // Detached descendants must not outlive this tool call.
      if (!copy.Wait(5000)) throw new IOException("Sandbox output did not close");
    } catch (Exception error) { Console.Error.WriteLine("Sandbox failed (no unrestricted fallback): " + error.Message); exit=125; }
    finally {
      if (job!=IntPtr.Zero) { TerminateJobObject(job,130); CloseHandle(job); }
      if (process.process!=IntPtr.Zero) { TerminateProcess(process.process,130); WaitForSingleObject(process.process,5000); CloseHandle(process.process); }
      if (process.thread!=IntPtr.Zero) CloseHandle(process.thread);
      foreach(IntPtr handle in new [] {outRead,outWrite,inRead,inWrite}) if(handle!=IntPtr.Zero) CloseHandle(handle);
      if (attributesInitialized) DeleteProcThreadAttributeList(attrs);
      foreach(IntPtr pointer in new [] {attrs,caps,handles,env}) if(pointer!=IntPtr.Zero) Marshal.FreeHGlobal(pointer);
      bool cleaned=true;
      try { Cleanup(); } catch { cleaned=false; exit=125; }
      if(sid!=IntPtr.Zero) FreeSid(sid);
      if(createdProfile) try { RemoveProfile(profile); } catch(Exception error) { Console.Error.WriteLine("Sandbox profile cleanup failed: "+error.Message); cleaned=false; exit=125; }
      if(runDirectory!=null) {
        try { RemoveRun(runDirectory); } catch(Exception error) { Console.Error.WriteLine("Sandbox temporary cleanup failed: "+error.Message); cleaned=false; exit=125; }
      }
      if(lease!=null) {
        lease.Dispose();
        if(cleaned) try { File.Delete(leasePath); } catch(Exception error) { Console.Error.WriteLine("Sandbox recovery record cleanup failed: "+error.Message); exit=125; }
      }
    }
    return exit;
  }
}
