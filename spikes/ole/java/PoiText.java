import java.io.*; import java.nio.file.*;
import org.apache.poi.hwpf.extractor.WordExtractor;
import org.apache.poi.hslf.usermodel.*; import org.apache.poi.sl.usermodel.*;
public class PoiText { public static void main(String[] a) throws Exception {
 String f=a[0]; String t;
 try (InputStream in=new FileInputStream(f)) {
  if (f.endsWith(".doc")) { try(WordExtractor w=new WordExtractor(in)){ t=String.join("\n", w.getParagraphText()); } }
  else { try(HSLFSlideShow p=new HSLFSlideShow(in)){ StringBuilder sb=new StringBuilder(); for(HSLFSlide sl:p.getSlides()){ for(HSLFShape sh:sl.getShapes()){ if(sh instanceof HSLFTextShape ts){ String x=ts.getText(); if(x!=null) sb.append(x).append('\n'); } } } t=sb.toString(); } }
 }
 Files.writeString(Path.of(a[1]), t);
}}
